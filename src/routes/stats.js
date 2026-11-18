import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken, verifyCustomer, verifyTechnician, verifyAdmin } from "../middleware/auth.js";
import { last6Months } from "../utils.js";

const router = Router();

const STATUSES = ["requested", "accepted", "in-progress", "completed", "rejected", "cancelled"];

const byStatus = (rows) => STATUSES.map((s) => ({ status: s, count: rows.find((r) => r._id === s)?.count || 0 }));

const monthly = (rows) => last6Months().map((m) => ({ month: m, total: rows.find((r) => r._id === m)?.total || 0 }));

const monthlySum = (payments, match) =>
  payments
    .aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidAt" } }, total: { $sum: "$amount" } } },
    ])
    .toArray();

/** GET /api/stats/public - small numbers for the home page */
router.get("/public", async (req, res) => {
  const { users, bookings, services } = await collections();
  const [technicians, completedJobs, activeServices] = await Promise.all([
    users.countDocuments({ role: "technician" }),
    bookings.countDocuments({ status: "completed" }),
    services.countDocuments({ approvalStatus: "approved", isAvailable: true }),
  ]);
  res.json({ technicians, completedJobs, activeServices });
});

router.get("/customer", verifyToken, verifyCustomer, async (req, res) => {
  const { bookings, payments } = await collections();
  const rows = await bookings
    .aggregate([{ $match: { customerEmail: req.user.email } }, { $group: { _id: "$status", count: { $sum: 1 } } }])
    .toArray();
  const status = byStatus(rows);
  const count = (s) => status.find((x) => x.status === s).count;
  res.json({
    total: status.reduce((a, b) => a + b.count, 0),
    active: count("requested") + count("accepted") + count("in-progress"),
    completed: count("completed"),
    byStatus: status,
    spending: monthly(await monthlySum(payments, { customerEmail: req.user.email })),
  });
});

router.get("/technician", verifyToken, verifyTechnician, async (req, res) => {
  const { services, bookings, payments } = await collections();
  const email = req.user.email;
  const [totalServices, approvedServices, rows] = await Promise.all([
    services.countDocuments({ technicianEmail: email }),
    services.countDocuments({ technicianEmail: email, approvalStatus: "approved" }),
    bookings.aggregate([{ $match: { technicianEmail: email } }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
  ]);
  const status = byStatus(rows);
  res.json({
    totalServices,
    approvedServices,
    pendingRequests: status.find((x) => x.status === "requested").count,
    byStatus: status,
    earnings: monthly(await monthlySum(payments, { technicianEmail: email })),
  });
});

router.get("/admin", verifyToken, verifyAdmin, async (req, res) => {
  const { users, services, bookings, payments } = await collections();
  const [totalUsers, totalTechnicians, pendingServices, cats, rows] = await Promise.all([
    users.countDocuments({}),
    users.countDocuments({ role: "technician" }),
    services.countDocuments({ approvalStatus: "pending" }),
    services.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
    bookings.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
  ]);
  res.json({
    totalUsers,
    totalTechnicians,
    pendingServices,
    servicesByCategory: cats.map((c) => ({ category: c._id, count: c.count })),
    byStatus: byStatus(rows),
    revenue: monthly(await monthlySum(payments, {})),
  });
});

export default router;
