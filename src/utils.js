import { ObjectId } from "mongodb";

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const isValidId = (id) => typeof id === "string" && ObjectId.isValid(id) && String(new ObjectId(id)) === id;

export const toId = (id) => new ObjectId(id);

/** trims a value into a string (max length) or returns "" when it is not a string */
export const str = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export const monthKey = (d) => new Date(d).toISOString().slice(0, 7);

export function last6Months() {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
