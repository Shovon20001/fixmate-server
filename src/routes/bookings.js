import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken, verifyCustomer, verifyTechnician } from "../middleware/auth.js";
import { ACTIVE_STATUSES, TRANSITIONS } from "../constants.js";
import { isValidId, toId, str } from "../utils.js";

const router = Router();

const STATUS_FILTERS = ["requested", "accepted", "rejected", "in-progress", "completed", "cancelled"];

/** POST /api/bookings  (customer) - send a repair request */
router.post("/", verifyToken, verifyCustomer, async (req, res) => {
  const { serviceId, customerPhone, address, preferredDate, problemDescription } = req.body || {};
  const phone = str(customerPhone, 25);
  const addr = str(address, 250);
  const problem = str(problemDescription, 1000);

  if (!isValidId(serviceId)) return res.status(400).json({ message: "Invalid service" });
  if (phone.replace(/\D/g, "").length < 7) return res.status(400).json({ message: "Enter a valid phone number" });
  if (addr.length < 5) return res.status(400).json({ message: "Address is required" });
  if (problem.length < 20) return res.status(400).json({ message: "Describe the problem in at least 20 characters" });

  // preferred date must be today or later (1 day tolerance covers timezone differences)
  const date = new Date(`${String(preferredDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return res.status(400).json({ message: "Choose a valid preferred date" });
  const floor = new Date();
  floor.setUTCHours(0, 0, 0, 0);
  floor.setUTCDate(floor.getUTCDate() - 1);
  if (date < floor) return res.status(400).json({ message: "Preferred date must be today or a future date" });

  const { services, bookings } = await collections();
  const service = await services.findOne({
    _id: toId(serviceId),
    approvalStatus: "approved",
    isAvailable: true,
  });
  if (!service) return res.status(404).json({ message: "This service is not available" });
  if (service.technicianEmail === req.user.email) {
    return res.status(403).json({ message: "You cannot request your own service" });
  }

  const active = await bookings.findOne({
    customerEmail: req.user.email,
    serviceId: String(service._id),
    status: { $in: ACTIVE_STATUSES },
  });
  if (active) return res.status(409).json({ message: "You already have an active request for this service" });

  const now = new Date();
  const doc = {
    serviceId: String(service._id),
    serviceTitle: service.title,
    serviceImage: service.image,
    category: service.category,
    basePrice: service.basePrice,
    technicianName: service.technicianName,
    technicianEmail: service.technicianEmail,
    customerName: req.user.name,
    customerEmail: req.user.email,
    customerPhone: phone,
    address: addr,
    preferredDate: date,
    problemDescription: problem,
    status: "requested",
    finalAmount: service.basePrice,
    paymentStatus: "unpaid",
    statusHistory: [{ status: "requested", changedAt: now }],
    createdAt: now,
  };
  const result = await bookings.insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});

/** GET /api/bookings/my  (customer) - only the logged-in customer's bookings */
router.get("/my", verifyToken, verifyCustomer, async (req, res) => {
  const { bookings } = await collections();
  res.json(await bookings.find({ customerEmail: req.user.email }).sort({ createdAt: -1 }).toArray());
});

/** PATCH /api/bookings/:id/cancel  (customer, owner, only while "requested") */
router.patch("/:id/cancel", verifyToken, verifyCustomer, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Booking not found" });
  const { bookings } = await collections();
  const booking = await bookings.findOne({ _id: toId(req.params.id) });
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  if (booking.customerEmail !== req.user.email) {
    return res.status(403).json({ message: "Forbidden: this is not your booking" });
  }
  if (booking.status !== "requested") {
    return res.status(400).json({ message: "Only a requested job can be cancelled" });
  }
  // filtering on status makes the change atomic (no race with the technician accepting)
  const result = await bookings.updateOne(
    { _id: booking._id, status: "requested" },
    { $set: { status: "cancelled" }, $push: { statusHistory: { status: "cancelled", changedAt: new Date() } } }
  );
  if (!result.modifiedCount) return res.status(409).json({ message: "The job status has just changed. Please refresh." });
  res.json({ message: "Request cancelled" });
});

/** GET /api/bookings/technician  (technician) - only jobs assigned to the logged-in technician */
router.get("/technician", verifyToken, verifyTechnician, async (req, res) => {
  const { bookings } = await collections();
  const filter = { technicianEmail: req.user.email };
  if (STATUS_FILTERS.includes(req.query.status)) filter.status = req.query.status;
  res.json(await bookings.find(filter).sort({ createdAt: -1 }).toArray());
});

/**
 * PATCH /api/bookings/:id/status  (technician, owner)
 * Challenge 3 - the server enforces the pipeline:
 * requested -> accepted | rejected ; accepted -> in-progress ; in-progress -> completed (+ finalAmount)
 */
router.patch("/:id/status", verifyToken, verifyTechnician, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Booking not found" });
  const next = req.body?.status;

  const { bookings } = await collections();
  const booking = await bookings.findOne({ _id: toId(req.params.id) });
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  if (booking.technicianEmail !== req.user.email) {
    return res.status(403).json({ message: "Forbidden: this job belongs to another technician" });
  }

  const allowed = TRANSITIONS[booking.status] || [];
  if (!allowed.includes(next)) {
    return res.status(400).json({ message: `Invalid change: a "${booking.status}" job cannot become "${next}"` });
  }

  const set = { status: next };
  if (next === "completed") {
    const amount = Number(req.body?.finalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ message: "finalAmount must be a number greater than 0" });
    }
    set.finalAmount = Math.round(amount * 100) / 100;
  }

  const result = await bookings.updateOne(
    { _id: booking._id, status: booking.status },
    { $set: set, $push: { statusHistory: { status: next, changedAt: new Date() } } }
  );
  if (!result.modifiedCount) return res.status(409).json({ message: "The job status has just changed. Please refresh." });
  res.json({ message: `Job marked as ${next}` });
});

export default router;
