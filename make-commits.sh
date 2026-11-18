#!/usr/bin/env bash
# Creates a meaningful, step-by-step commit history. Run once in an empty git repo:  bash make-commits.sh
set -e
[ -d .git ] || git init -b main
c() { msg="$1"; shift; git add -- "$@" 2>/dev/null || true; git diff --cached --quiet || git commit -q -m "$msg"; }
c "chore: initialize Express server project" package.json package-lock.json .gitignore
c "chore: add environment template and Vercel config" .env.example vercel.json
c "feat: add MongoDB connection helper with unique payment indexes" src/db.js
c "feat: add shared constants, status transitions and utilities" src/constants.js src/utils.js
c "feat: add JWT verifyToken and role middlewares (401/403)" src/middleware/auth.js
c "feat: add services API with server-side search, filter, sort and pagination, plus technician CRUD" src/routes/services.js
c "feat: add booking requests with duplicate protection, cancel and server-enforced status pipeline" src/routes/bookings.js
c "feat: add Stripe checkout, payment verification and idempotent webhook" src/routes/payments.js
c "feat: add admin APIs for users, approvals, bookings and revenue" src/routes/admin.js
c "feat: add profile update API" src/routes/users.js
c "feat: add ImgBB upload proxy" src/routes/upload.js
c "feat: add dashboard statistics endpoints" src/routes/stats.js
c "feat: wire up app with CORS, raw webhook body and error handling" index.js
c "docs: add README with API reference and deploy steps" README.md
git log --oneline | cat
