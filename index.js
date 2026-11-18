import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import express from "express";
import cors from "cors";
import servicesRouter from "./src/routes/services.js";
import bookingsRouter from "./src/routes/bookings.js";
import paymentsRouter, { webhookHandler } from "./src/routes/payments.js";
import adminRouter from "./src/routes/admin.js";
import usersRouter from "./src/routes/users.js";
import uploadRouter from "./src/routes/upload.js";
import statsRouter from "./src/routes/stats.js";

const app = express();

// Allowed browser origins: every URL in CLIENT_URL (comma separated) + local dev
const allowed = [
  ...(process.env.CLIENT_URL || "").split(","),
  "http://localhost:3000",
]
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // no origin = server-to-server (Stripe webhook, curl, health checks)
      if (!origin || allowed.includes(origin.replace(/\/$/, ""))) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} is not allowed`));
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Stripe needs the RAW body to verify the signature - mount BEFORE express.json()
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), webhookHandler);

app.use(express.json({ limit: "12mb" }));

app.get("/", (req, res) => res.json({ name: "FixMate API", status: "running" }));

app.use("/api/services", servicesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/users", usersRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/stats", statsRouter);

app.use((req, res) => res.status(404).json({ message: "Route not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.message?.startsWith("CORS") ? 403 : 500;
  res.status(status).json({ message: status === 403 ? err.message : "Something went wrong on the server" });
});

if (!process.env.VERCEL) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`FixMate API listening on port ${port}`));
}

export default app;
