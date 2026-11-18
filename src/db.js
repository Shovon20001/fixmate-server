import { MongoClient } from "mongodb";

let dbPromise = null;

async function ensureIndexes(db) {
  await Promise.all([
    db.collection("payments").createIndex({ stripeSessionId: 1 }, { unique: true }),
    // one booking can have at most one payment
    db.collection("payments").createIndex({ bookingId: 1 }, { unique: true }),
    db.collection("services").createIndex({ approvalStatus: 1, isAvailable: 1, createdAt: -1 }),
    db.collection("services").createIndex({ technicianEmail: 1 }),
    db.collection("bookings").createIndex({ customerEmail: 1, createdAt: -1 }),
    db.collection("bookings").createIndex({ technicianEmail: 1, createdAt: -1 }),
  ]);
}

/** Cached connection (works for long running servers and for serverless cold starts). */
export function getDb() {
  if (!dbPromise) {
    if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
    const client = new MongoClient(process.env.MONGODB_URI);
    dbPromise = client
      .connect()
      .then((c) => {
        const db = c.db(process.env.MONGODB_DB || "fixmate");
        ensureIndexes(db).catch((e) => console.error("Index creation failed:", e.message));
        return db;
      })
      .catch((err) => {
        dbPromise = null; // allow retry on next request
        throw err;
      });
  }
  return dbPromise;
}

export const collections = async () => {
  const db = await getDb();
  return {
    users: db.collection("user"), // BetterAuth's user collection = our "users" collection
    services: db.collection("services"),
    bookings: db.collection("bookings"),
    payments: db.collection("payments"),
  };
};
