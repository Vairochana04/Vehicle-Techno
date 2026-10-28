# API Reference (base `/api`, JWT Bearer auth)

| Method & Path | Role | Purpose |
|---|---|---|
| POST /auth/register · /auth/login · /auth/otp/request · /auth/otp/verify · GET /auth/me | Public/User | Auth (OTP demo mode returns code; wire Twilio in prod) |
| GET /health | Public | Health check |
| POST /jobs | BANK | Create job → verification + broadcast |
| GET /jobs · GET /jobs/:id | All (filtered) | Lists are role-scoped; seeker payload hides AI internals & ledger |
| POST /jobs/:id/accept | INSPECTOR | Exclusive claim (409 if taken, 403 outside radius / priority window) |
| POST /jobs/:id/start | Assigned inspector | Begin inspection |
| POST /jobs/:id/inspection | Assigned inspector | Submit inspection → instant pay + AI pipeline |
| POST /jobs/:id/analyze | ADMIN/BANK | Re-run AI + valuation (idempotent) |
| POST /jobs/:id/audit | ADMIN | APPROVE / SENIOR_REVIEW (optional final) / RE_INSPECTION |
| GET /jobs/:id/report · /report.pdf?variant=full\|summary | All | Seeker always receives summary |
| POST /jobs/:id/rate | LOAN_SEEKER/BANK | 4-dimension rating → composite 0.4/0.6 |
| POST /jobs/:id/settle | BANK/ADMIN | Bank→platform, commission, margin (409 if settled/not delivered) |
| GET /admin/overview · /admin/inspectors · PATCH /admin/inspectors/:id/status · PATCH /admin/settings · GET /admin/ledger · /admin/audit-log · /admin/notifications | ADMIN/BANK/INSPECTOR(scoped) | Governance, money, audit, notifications |
| POST /upload (multipart `file`) | INSPECTOR/BANK | Stores file, returns SHA-256 hash + geo/time metadata |

Demo data resets by deleting `apps/api/data/valuation.db`. Production: set `JWT_SECRET`, `PORT`, `DB_PATH` env vars.
| POST /jobs/:id/bank-feedback | BANK (owner) | Report quality/timeliness/accuracy feedback (once; avg ≤2 alerts admins) |
Login is rate-limited (10 failures/15 min → 429). In production (`NODE_ENV=production`) OTP codes are never returned in API responses.
