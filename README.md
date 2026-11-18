# FixMate Server

Express + MongoDB REST API for **FixMate**, a repair-service booking platform where customers pay only after the job is completed.

- **Live API:** https://YOUR-SERVER.vercel.app
- **Client repo / live site:** https://YOUR-CLIENT.vercel.app

## Features
- JWT auth middlewares: `verifyToken` (401), `verifyCustomer` / `verifyTechnician` / `verifyAdmin` (403). Roles are re-read from MongoDB on every request.
- Public services API with **server-side search, filter, sort and pagination**.
- Technician service CRUD (edit resets approval to `pending`), availability toggle.
- Bookings with duplicate-active-request protection, and a **server-enforced status pipeline**:
  `requested -> accepted | rejected`, `accepted -> in-progress`, `in-progress -> completed (+finalAmount)`.
- Stripe Checkout (test mode): amount always read from the database, payment gate (completed + unpaid + owner only), verification endpoint **and** webhook, with unique indexes so a payment is never saved twice.
- Admin APIs: users and roles, service approval, all bookings, transactions and total revenue.
- ImgBB upload proxy (key never reaches the browser), profile update, dashboard stats.

## Packages
express, cors, mongodb, jsonwebtoken, stripe, dotenv

## Run locally
```bash
npm install
cp .env.example .env     # fill in the values
npm run dev              # http://localhost:5000
```
`JWT_SECRET` must be identical in the client `.env.local`. Demo data is created from the client repo with `npm run seed`.

## API
| Method | Route | Access |
|---|---|---|
| GET | `/api/services?search&category&mode&sort&page&limit` | public |
| GET | `/api/services/:id` | public (approved + available only) |
| GET | `/api/services/mine` | technician |
| POST / PATCH / DELETE | `/api/services`, `/api/services/:id` | technician (owner) |
| PATCH | `/api/services/:id/availability` | technician (owner) |
| POST | `/api/bookings` | customer |
| GET | `/api/bookings/my` | customer |
| PATCH | `/api/bookings/:id/cancel` | customer (owner, while requested) |
| GET | `/api/bookings/technician?status=` | technician |
| PATCH | `/api/bookings/:id/status` | technician (owner) |
| POST | `/api/payments/create-checkout-session` | customer (owner, completed + unpaid) |
| GET | `/api/payments/verify?session_id=` | customer |
| GET | `/api/payments/my` | customer |
| POST | `/api/payments/webhook` | Stripe signature |
| GET | `/api/admin/users`, `/services`, `/bookings`, `/payments` | admin |
| PATCH | `/api/admin/users/:id/role`, `/api/admin/services/:id/approval` | admin |
| PATCH | `/api/users/profile` | any logged-in user |
| POST | `/api/upload` | any logged-in user |
| GET | `/api/stats/public`, `/customer`, `/technician`, `/admin` | public / role |

## Deploy (Vercel)
1. Import this repo, add every variable from `.env.example`. Set `CLIENT_URL` to your deployed client URL (no trailing slash).
2. In MongoDB Atlas, allow network access `0.0.0.0/0`.
3. **Stripe webhook:** Dashboard > Developers > Webhooks > add endpoint `https://YOUR-SERVER.vercel.app/api/payments/webhook`, event `checkout.session.completed`, then copy the signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.
4. Local webhook testing: `stripe listen --forward-to localhost:5000/api/payments/webhook`.
