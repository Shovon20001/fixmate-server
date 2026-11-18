import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken, verifyTechnician } from "../middleware/auth.js";
import { CATEGORIES, MODES } from "../constants.js";
import { escapeRegex, isValidId, toId, str } from "../utils.js";

const router = Router();

const SORTS = {
  newest: { createdAt: -1 },
  "price-asc": { basePrice: 1, createdAt: -1 },
  "price-desc": { basePrice: -1, createdAt: -1 },
};

function validateService(body = {}) {
  const data = {
    title: str(body.title, 80),
    category: str(body.category, 40),
    description: str(body.description, 1500),
    image: str(body.image, 500),
    basePrice: Number(body.basePrice),
    estimatedDuration: str(body.estimatedDuration, 40),
    serviceMode: str(body.serviceMode, 40),
    serviceArea: str(body.serviceArea, 80),
  };
  if (data.title.length < 3) return { error: "Title must be at least 3 characters" };
  if (!CATEGORIES.includes(data.category)) return { error: "Please choose a valid category" };
  if (data.description.length < 20) return { error: "Description must be at least 20 characters" };
  if (!data.image) return { error: "A service image is required" };
  if (!Number.isFinite(data.basePrice) || data.basePrice <= 0) return { error: "Base price must be a positive number" };
  if (!data.estimatedDuration) return { error: "Estimated duration is required" };
  if (!MODES.includes(data.serviceMode)) return { error: "Please choose a valid service mode" };
  if (!data.serviceArea) return { error: "Service area is required" };
  return { data };
}

/**
 * GET /api/services  (public)
 * Challenge 1 - search, filter, sort (+ pagination) all done by MongoDB.
 * query: search, category, mode, sort (newest | price-asc | price-desc), page, limit
 */
router.get("/", async (req, res) => {
  const { services } = await collections();
  const { search = "", category = "", mode = "", sort = "newest" } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));

  const filter = { approvalStatus: "approved", isAvailable: true };
  if (CATEGORIES.includes(category)) filter.category = category;
  if (MODES.includes(mode)) filter.serviceMode = mode;
  if (typeof search === "string" && search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim().slice(0, 60)), "i");
    filter.$or = [{ title: rx }, { category: rx }];
  }

  const [items, total] = await Promise.all([
    services
      .find(filter)
      .sort(SORTS[sort] || SORTS.newest)
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    services.countDocuments(filter),
  ]);

  res.json({ items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
});

/** GET /api/services/mine  (technician) - every service owned by the logged-in technician */
router.get("/mine", verifyToken, verifyTechnician, async (req, res) => {
  const { services } = await collections();
  const items = await services.find({ technicianEmail: req.user.email }).sort({ createdAt: -1 }).toArray();
  res.json(items);
});

/** GET /api/services/:id  (public) - only approved + available services */
router.get("/:id", async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Service not found" });
  const { services, users } = await collections();
  const service = await services.findOne({
    _id: toId(req.params.id),
    approvalStatus: "approved",
    isAvailable: true,
  });
  if (!service) return res.status(404).json({ message: "Service not found" });

  const tech = await users.findOne(
    { email: service.technicianEmail },
    { projection: { name: 1, image: 1, area: 1, bio: 1, phone: 1 } }
  );
  res.json({
    ...service,
    technician: {
      name: tech?.name || service.technicianName,
      image: tech?.image || "",
      area: tech?.area || service.serviceArea,
      bio: tech?.bio || "",
    },
  });
});

/** POST /api/services  (technician) */
router.post("/", verifyToken, verifyTechnician, async (req, res) => {
  const { error, data } = validateService(req.body);
  if (error) return res.status(400).json({ message: error });

  const { services } = await collections();
  const doc = {
    ...data,
    technicianName: req.user.name, // always taken from the logged-in technician
    technicianEmail: req.user.email,
    approvalStatus: "pending",
    isAvailable: true,
    createdAt: new Date(),
  };
  const result = await services.insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});

/** PATCH /api/services/:id  (technician, owner) - editing sends it back to "pending" */
router.patch("/:id", verifyToken, verifyTechnician, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Service not found" });
  const { error, data } = validateService(req.body);
  if (error) return res.status(400).json({ message: error });

  const { services } = await collections();
  const found = await services.findOne({ _id: toId(req.params.id) });
  if (!found) return res.status(404).json({ message: "Service not found" });
  if (found.technicianEmail !== req.user.email) {
    return res.status(403).json({ message: "Forbidden: you can only edit your own services" });
  }

  await services.updateOne(
    { _id: found._id },
    { $set: { ...data, approvalStatus: "pending", updatedAt: new Date() } }
  );
  res.json({ message: "Service updated and sent for admin approval" });
});

/** PATCH /api/services/:id/availability  (technician, owner) */
router.patch("/:id/availability", verifyToken, verifyTechnician, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Service not found" });
  if (typeof req.body?.isAvailable !== "boolean") {
    return res.status(400).json({ message: "isAvailable must be true or false" });
  }
  const { services } = await collections();
  const result = await services.updateOne(
    { _id: toId(req.params.id), technicianEmail: req.user.email },
    { $set: { isAvailable: req.body.isAvailable } }
  );
  if (!result.matchedCount) return res.status(404).json({ message: "Service not found" });
  res.json({ message: "Availability updated" });
});

/** DELETE /api/services/:id  (technician, owner) */
router.delete("/:id", verifyToken, verifyTechnician, async (req, res) => {
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Service not found" });
  const { services } = await collections();
  const result = await services.deleteOne({ _id: toId(req.params.id), technicianEmail: req.user.email });
  if (!result.deletedCount) return res.status(404).json({ message: "Service not found" });
  res.json({ message: "Service deleted" });
});

export default router;
