export const CATEGORIES = [
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
];
export const MODES = ["Home Visit", "Shop Drop-off"];
export const ROLES = ["customer", "technician", "admin"];
export const ACTIVE_STATUSES = ["requested", "accepted", "in-progress"];

// Job status pipeline: current status -> statuses a technician may move to.
export const TRANSITIONS = {
  requested: ["accepted", "rejected"],
  accepted: ["in-progress"],
  "in-progress": ["completed"],
};
