import { Router } from "express";
import { ObjectId } from "mongodb";
import { collections } from "../db.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";
import { ROLES } from "../constants.js";
import { isValidId, toId } from "../utils.js";

const router = Router();
router.use(verifyToken, verifyAdmin);

const userFilter = (id) => {
  const ors = [{ _id: id }, { id }];
  if (ObjectId.isValid(id)) ors.push({ _id: new ObjectId(id) });
  return { $or: ors };
};

/** GET /api/admin/users */
router.get("/users", async (req, res) => {
  const { users } = await collections();
  const list = await users
    .find({}, { projection: { name: 1, email: 1, image: 1, role: 1, createdAt: 1, phone: 1, area: 1 } })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(list);
});

/** PATCH /api/admin/users/:id/role - the admin cannot change their own role */
router.patch("/users/:id/role", async (req, res) => {
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ message: "Invalid role" });
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: "You cannot change your own role" });
  }
  const { users } = await collections();
  const result = await users.updateOne(userFilter(req.params.id), { $set: { role, updatedAt: new Date() } });
  if (!result.matchedCount) return res.status(404).json({ message: "User not found" });
  res.json({ message: "Role updated" });
});

/** GET /api/admin/services?status=pending|approved|rejected */
router.get("/services", async (req, res) => {
  const { services } = await collections();
  const filter = ["pending", "approved", "rejected"].includes(req.query.status)
    ? { approvalStatus: req.query.status }
    : {};
  res.json(await services.find(filter).sort({ createdAt: -1 }).toArray());
});

/** PATCH /api/admin/services/:id/approval */
router.patch("/services/:id/approval", async (req, res) => {
  const { approvalStatus } = req.body || {};
  if (!["approved", "rejected"].includes(approvalStatus)) {
    return res.status(400).json({ message: "approvalStatus must be approved or rejected" });
  }
  if (!isValidId(req.params.id)) return res.status(404).json({ message: "Service not found" });
  const { services } = await collections();
  const result = await services.updateOne({ _id: toId(req.params.id) }, { $set: { approvalStatus } });
  if (!result.matchedCount) return res.status(404).json({ message: "Service not found" });
  res.json({ message: `Service ${approvalStatus}` });
});

/** GET /api/admin/bookings?status= */
router.get("/bookings", async (req, res) => {
  const { bookings } = await collections();
  const filter = req.query.status ? { status: String(req.query.status) } : {};
  res.json(await bookings.find(filter).sort({ createdAt: -1 }).toArray());
});

/** GET /api/admin/payments - every transaction + total revenue */
router.get("/payments", async (req, res) => {
  const { payments } = await collections();
  const [items, agg] = await Promise.all([
    payments.find({}).sort({ paidAt: -1 }).toArray(),
    payments.aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
  ]);
  res.json({ items, totalRevenue: agg[0]?.total || 0 });
});

export default router;
