import { Router } from "express";
import { collections } from "../db.js";
import { verifyToken } from "../middleware/auth.js";
import { str } from "../utils.js";

const router = Router();

/** PATCH /api/users/profile  (any logged-in user) - name, phone, area, bio, image. Email & role are read-only. */
router.patch("/profile", verifyToken, async (req, res) => {
  const body = req.body || {};
  const name = str(body.name, 60);
  if (name.length < 2) return res.status(400).json({ message: "Name must be at least 2 characters" });

  const update = {
    name,
    phone: str(body.phone, 25),
    area: str(body.area, 80),
    bio: str(body.bio, 400),
    updatedAt: new Date(),
  };
  if (typeof body.image === "string" && body.image.trim()) update.image = body.image.trim().slice(0, 500);

  const { users, services } = await collections();
  await users.updateOne({ email: req.user.email }, { $set: update });
  if (req.user.role === "technician") {
    await services.updateMany({ technicianEmail: req.user.email }, { $set: { technicianName: name } });
  }
  res.json({ message: "Profile updated" });
});

export default router;
