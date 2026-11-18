import jwt from "jsonwebtoken";
import { collections } from "../db.js";

/**
 * verifyToken
 * - 401 when the Bearer token is missing / invalid / expired
 * - the role is ALWAYS re-read from the database, never trusted from the token,
 *   so an admin changing a role takes effect immediately.
 */
export async function verifyToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Unauthorized: token is missing" });

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: "Unauthorized: invalid or expired token" });
  }

  const { users } = await collections();
  const user = await users.findOne({ email: payload.email });
  if (!user) return res.status(401).json({ message: "Unauthorized: user not found" });

  req.user = {
    id: String(user._id),
    email: user.email,
    name: user.name,
    image: user.image || "",
    role: user.role || "customer",
  };
  next();
}

const requireRole = (role) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  if (req.user.role !== role) {
    return res.status(403).json({ message: `Forbidden: ${role} access only` });
  }
  next();
};

export const verifyCustomer = requireRole("customer");
export const verifyTechnician = requireRole("technician");
export const verifyAdmin = requireRole("admin");
