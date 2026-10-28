# Valuation Techno — Smart Valuation. Safer Transactions

India's AI-powered Used Vehicle Valuation & FinTech platform — complete implementation of the Technical Proposal case study (all 6 phases, 25 workflow steps).

## Quick start
```bash
npm install
npm run build      # builds React frontend
npm start          # API + frontend on http://localhost:4000
npm test           # 26 automated tests (Node test runner + Supertest + WebSocket)
```
Open **http://localhost:4000** and use one-click demo logins (or passwords below).

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
1. **Job Creation** — bank creates job → VAHAN/IIB verification (RC, insurance, ownership, accident/claims) → radius broadcast → exclusive first-accept *or* rating-priority mode (Admin toggle).
2. **Inspection** — geotagged/timestamped photo metadata + real file upload (SHA-256 hash), documents, condition, damages, manual valuation → **₹1,200 instant pay (exactly once)**.
3. **AI Analysis** — damage detection + parts/labor/paint costing; killfake-style fraud checks (GPS, timestamp, duplicate hash, metadata, odometer, chassis) with confidence score.
4. **Dual Valuation** — DeepSearch market price adjusted for damage/fraud vs manual → **Green ≤5% auto-approve (final = average)** · **Red >5% → admin audit / re-inspection**.
5. **Reports & Rating** — full (bank) / summary (seeker, privacy-enforced) HTML + PDF reports → **Final Rating = 0.4×Seeker + 0.6×Platform** → bonus / retraining / suspension.
6. **Payments** — seeker fee → bank-to-platform → 20% commission + 80% provider margin; idempotent ledger + full audit trail + notifications. OTP/JWT auth included.

## Architecture
React (Vite) frontend · Node 22 + Express API + **WebSocket real-time layer (live job broadcast, valuation, rating & payment events — no refresh)** · SQLite (`node:sqlite`, zero native deps) · Zod validation · JWT/bcrypt · **AI-animated UI: vehicle Digital Twin, fraud gauge, AI vision scan, live broadcast map, DeepSearch forecast chart, AI analytics & inspector leaderboard** · full PDF coverage: `docs/FEATURE_MATRIX.md`.
External/AI systems (VAHAN, IIB, DeepSearch, killfake.ai, YOLOv8, XGBoost, Razorpay) are deterministic simulators behind provider interfaces in `apps/api/src/services/providers.js` — swap in live vendor APIs or a Python FastAPI ML microservice without touching routes/UI. Rationale: `docs/TECH_STACK_DECISION.md`; full mapping: `docs/CASE_STUDY_ANALYSIS.md`; endpoints: `docs/API.md`; test evidence: `docs/TEST_REPORT.md`.

## Try the demo flow (5 minutes)
Bank: create job (`TN38AB1234`, Hyundai Creta) → Inspector Ravi: Accept → Start → Submit inspection (manual ≈ ₹7.3–7.5 lakh for a Green flag; ₹1,00,000 forces Red/audit) → Bank: view full report/PDF → Loan Seeker: rate inspector → Bank: Settle → Admin: ledger + audit queue + allocation-mode toggle.
