# Valuation Techno — Smart Valuation. Safer Transactions

A full-stack prototype for the used-vehicle valuation workflow described in the project proposal.

> **Important: this repository is not yet a live financial service.** The local preview uses seeded example jobs and deterministic vehicle, market, damage, and fraud simulators. Portal ledger entries do not move money. Production mode is intentionally fail-closed until approved provider integrations are implemented.

## Production safety

- Production startup requires a private, strong `JWT_SECRET`, persistent `DB_PATH`, and explicit `CORS_ORIGIN`.
- Production does not seed demo users or jobs. It can create one administrator from private `BOOTSTRAP_ADMIN_*` settings on a new database; do not deploy the local preview database as the production database.
- The current VAHAN/IIB, market, damage/fraud, OTP, inspector-payout, and bank-settlement simulators do not run in production. Those routes return a clear unavailable response instead of saving simulated results or claiming a transfer.
- Bank and inspector self-registration is disabled in production. Their secure account-provisioning workflow still needs to be set up.
- Existing database records are not deleted by these safeguards. Use a separate persistent production database and migrate only records that should be live.

## Quick start
```bash
npm install
npm run build      # builds React frontend
npm start          # API + frontend on http://localhost:4000
npm test           # 26 automated tests (Node test runner + Supertest + WebSocket)
```
Open **http://localhost:4000** and use the non-production example credentials below. One-click demo buttons appear only in development/demo builds.

| Role | Email | Password |
|---|---|---|
| Bank (HDFC) | bank@valuation.techno | Bank@123 |
| Bank (ICICI) | bank2@valuation.techno | Bank@123 |
| Inspector ★4.6 | inspector@valuation.techno | Inspector@123 |
| Inspector ★4.4 | inspector4@valuation.techno | Inspector@123 |
| Inspector ★4.1 | inspector2@valuation.techno | Inspector@123 |
| Inspector ★3.9 | inspector5@valuation.techno | Inspector@123 |
| Inspector (Chennai — radius test) | inspector3@valuation.techno | Inspector@123 |
| Loan Seeker | seeker@valuation.techno | Seeker@123 |
| Loan Seeker (Kavya) | seeker2@valuation.techno | Seeker@123 |
| Loan Seeker (Rajesh Kumar) | seeker3@valuation.techno | Seeker@123 |
| Admin | admin@valuation.techno | Admin@123 |

The app seeds **12 demo jobs across every status** (Broadcast → Settled, incl. one RED flag waiting in the Admin audit queue), 5 inspectors, 2 banks, ratings, bank feedback, chat messages and a full money ledger spread over the last 14 days — so every dashboard, chart and queue looks alive on first login.

## What is implemented (phase → where)
1. **Job Creation** — bank creates a job → preview-only VAHAN/IIB verification → radius broadcast → exclusive first-accept *or* rating-priority mode (Admin toggle).
2. **Inspection** — geotagged/timestamped photo metadata + file upload (SHA-256 hash), documents, condition, damages, and manual valuation. The preview records an example ₹1,200 inspector-pay ledger entry; it does not transfer money.
3. **AI Analysis** — preview-only damage/fraud scoring and cost estimates; not a connected Killfake.ai or production vision model.
4. **Dual Valuation** — simulated market value and analysis vs manual valuation → **Green ≤5% (final = average)** · **Red >5% → admin audit / re-inspection**.
5. **Reports & Rating** — full (bank) / summary (seeker) HTML + PDF reports → **Final Rating = 0.4×Seeker + 0.6×Platform** → bonus / retraining / suspension.
6. **Portal ledger** — the preview models fee, commission, and provider-margin entries for workflow testing. These are records only; no customer fee, inspector payout, or bank settlement is processed. OTP demo is also not connected to a live SMS provider.

## Architecture
React (Vite) frontend · Node 22 + Express API + **WebSocket real-time layer (live job broadcast, valuation, rating & payment events — no refresh)** · SQLite (`node:sqlite`, zero native deps) · Zod validation · JWT/bcrypt · **AI-animated UI: vehicle Digital Twin, fraud gauge, AI vision scan, live broadcast map, DeepSearch forecast chart, AI analytics & inspector leaderboard** · full PDF coverage: `docs/FEATURE_MATRIX.md`.
External/AI systems (VAHAN, IIB, DeepSearch, killfake.ai, YOLOv8, XGBoost, Razorpay) are deterministic simulators behind provider interfaces in `apps/api/src/services/providers.js` — swap in live vendor APIs or a Python FastAPI ML microservice without touching routes/UI. Rationale: `docs/TECH_STACK_DECISION.md`; full mapping: `docs/CASE_STUDY_ANALYSIS.md`; endpoints: `docs/API.md`; test evidence: `docs/TEST_REPORT.md`.

## Try the demo flow (5 minutes)
Bank: create job (`TN38AB1234`, Hyundai Creta) → Inspector Ravi: Accept → Start → Submit inspection (manual ≈ ₹7.3–7.5 lakh for a Green flag; ₹1,00,000 forces Red/audit) → Bank: view full report/PDF → Loan Seeker: rate inspector → Bank: Settle → Admin: ledger + audit queue + allocation-mode toggle.
