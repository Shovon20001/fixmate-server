import { Router } from "express";
import Stripe from "stripe";
import { collections } from "../db.js";
import { verifyToken, verifyCustomer } from "../middleware/auth.js";
import { isValidId, toId } from "../utils.js";

const router = Router();

let stripeClient;
const stripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  return (stripeClient ??= new Stripe(process.env.STRIPE_SECRET_KEY));
};

const clientUrl = () => (process.env.CLIENT_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");

/**
 * Saves a paid Checkout Session ONCE.
 * Called by the success-page verification AND by the webhook - the unique indexes on
 * payments.stripeSessionId and payments.bookingId guarantee the same payment is never saved twice.
 */
export async function recordPayment(session) {
  if (!session || session.payment_status !== "paid") return null;
  const bookingId = session.metadata?.bookingId;
  if (!isValidId(bookingId)) return null;

  const { bookings, payments } = await collections();
  const booking = await bookings.findOne({ _id: toId(bookingId) });
  if (!booking) return null;

  const doc = {
    bookingId: String(booking._id),
    serviceTitle: booking.serviceTitle,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    technicianName: booking.technicianName,
    technicianEmail: booking.technicianEmail,
    amount: (session.amount_total ?? Math.round(booking.finalAmount * 100)) / 100,
    currency: session.currency || "usd",
    transactionId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || "",
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  try {
    await payments.updateOne({ stripeSessionId: session.id }, { $setOnInsert: doc }, { upsert: true });
  } catch (err) {
    if (err?.code !== 11000) throw err; // duplicate = already saved by the other path, that's fine
  }

  await bookings.updateOne(
    { _id: booking._id, paymentStatus: "unpaid" },
    { $set: { paymentStatus: "paid" }, $push: { statusHistory: { status: "paid", changedAt: new Date() } } }
  );

  return (await payments.findOne({ stripeSessionId: session.id })) || (await payments.findOne({ bookingId: String(booking._id) }));
}

/** POST /api/payments/create-checkout-session  (customer) */
router.post("/create-checkout-session", verifyToken, verifyCustomer, async (req, res) => {
  const { bookingId } = req.body || {};
  if (!isValidId(bookingId)) return res.status(400).json({ message: "Invalid booking" });

  const { bookings } = await collections();
  const booking = await bookings.findOne({ _id: toId(bookingId) });
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  if (booking.customerEmail !== req.user.email) {
    return res.status(403).json({ message: "Forbidden: this is not your booking" });
  }
  // payment gate (Challenge 3): only completed + unpaid jobs can be paid
  if (booking.status !== "completed" || booking.paymentStatus !== "unpaid") {
    return res.status(400).json({ message: "Only a completed and unpaid job can be paid" });
  }
  // the amount ALWAYS comes from the database, never from the client
  const amount = Math.round(Number(booking.finalAmount) * 100);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: "Invalid job amount" });

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: req.user.email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: {
            name: booking.serviceTitle,
            description: `Repair job by ${booking.technicianName}`,
          },
        },
      },
    ],
    metadata: { bookingId: String(booking._id), customerEmail: req.user.email },
    success_url: `${clientUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${clientUrl()}/payment/cancel`,
  });

  res.json({ url: session.url, sessionId: session.id });
});

/** GET /api/payments/verify?session_id=...  (customer) - called by /payment/success */
router.get("/verify", verifyToken, verifyCustomer, async (req, res) => {
  const sessionId = String(req.query.session_id || "");
  if (!sessionId.startsWith("cs_")) return res.status(400).json({ message: "Invalid session id" });

  const session = await stripe().checkout.sessions.retrieve(sessionId);
  if (session.metadata?.customerEmail !== req.user.email) {
    return res.status(403).json({ message: "Forbidden: this payment belongs to another account" });
  }
  if (session.payment_status !== "paid") {
    return res.status(400).json({ message: "Payment has not been completed" });
  }
  const payment = await recordPayment(session);
  if (!payment) return res.status(404).json({ message: "Booking for this payment was not found" });
  res.json({ payment });
});

/** GET /api/payments/my  (customer) - payment history */
router.get("/my", verifyToken, verifyCustomer, async (req, res) => {
  const { payments } = await collections();
  res.json(await payments.find({ customerEmail: req.user.email }).sort({ paidAt: -1 }).toArray());
});

/** POST /api/payments/webhook - Stripe webhook (mounted with express.raw in index.js) */
export async function webhookHandler(req, res) {
  let event;
  try {
    event = stripe().webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await recordPayment(event.data.object);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handling failed:", err);
    res.status(500).json({ message: "Webhook handler failed" }); // Stripe will retry safely
  }
}

export default router;
