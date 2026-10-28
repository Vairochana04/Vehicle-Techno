# Test Report — 2026-10-24

**Automated suite: 11/11 PASS** (`npm test` — Node test runner + Supertest, isolated temp DB per run). Frontend production build passes (Vite). Manual curl/Python E2E + PDF check pass on the live server.

| # | Test | Result |
|---|---|---|
| 1 | Variance 5% boundary (≤5 Green, >5 Red; 700000 vs 738500 = 5.21%) | ✅ |
| 2 | Plate verification rejects invalid, passes Indian format | ✅ |
| 3 | Platform accuracy score penalizes variance | ✅ |
| 4 | Wrong password 401, unauthenticated 401 | ✅ |
| 5 | OTP request/verify + wrong OTP 401 | ✅ |
| 6 | Inspector cannot create jobs (403 role guard) | ✅ |
| 7 | Invalid registration → 422 with verification detail | ✅ |
| 8 | Far inspector radius-blocked (403); exclusive accept — second accept 409 | ✅ |
| 9 | GREEN E2E: inspection→AI→auto-approve→report→rating 0.4/0.6→settle; duplicate inspection/rate/settle all 409; instant pay exactly once; seeker summary hides AI valuation | ✅ |
| 10 | Fraud E2E: duplicate hashes + GPS mismatch + odometer tamper → fraud ≥55, RED, settle blocked, admin audit approves at senior final | ✅ |
| 11 | RATING_PRIORITY blocks lower-rated inspector in window, top-rated accepts | ✅ |

Bugs found & fixed during development: ledger INSERT column count (10 vs 9), valuations INSERT column count (12 vs 11), pipeline-failure rollback (inspection/ledger never stranded), Vitest↔`node:sqlite` incompatibility (moved to Node test runner).
Known limits (by design, documented): AI/vendors are deterministic simulators behind provider interfaces; OTP is demo-mode; SQLite suits demo/single-node — Postgres swap documented in TECH_STACK_DECISION.md.

## Step 9 — Hardening (added later, 15/15 PASS)
| # | Test | Result |
|---|---|---|
| 12 | Bank feedback: stores once (avg 4.67), duplicate 409, seeker 403, visible in job detail | ✅ |
| 13 | Re-inspection cycle: RED → admin re-inspection → BROADCAST → fresh GREEN inspection; instant pay once per cycle (2 total) | ✅ |
| 14 | PDF report is a real PDF download; multipart upload returns 64-char SHA-256 for fraud checks | ✅ |
| 15 | Suspended inspector blocked at login (403); admin reactivation restores access | ✅ |
Plus: login brute-force rate limiting (10/15 min), prod OTP secrecy, security headers, annotated damage report, offline inspection drafts (localStorage). Bug fixed this step: auth.js file corruption from a partial edit — fully rewritten & syntax-checked.

## Production realtime upgrade (18/18 PASS)
| # | Test | Result |
|---|---|---|
| 16 | DeepSearch market: 12-mo trend + 3-mo forecast + 6 comparables | ✅ |
| 17 | AI analytics role-guarded; leaderboard + fraud distribution + variance health | ✅ |
| 18 | WebSocket: inspector receives JOB_CREATED instantly on bank job creation (also proven live outside tests) | ✅ |
Frontend build passes with AI-animated panels (Fraud Gauge, Digital Twin, AI Scan, Live Map, Market Chart, Analytics).

## UI usability overhaul (user-reported: same dashboards, dead buttons)
Root causes found & fixed: (1) Report/PDF were plain links without JWT → 401 on click — now authenticated blob open; (2) all roles shared one dashboard — now 4 distinct role dashboards with direct action buttons; (3) buttons had no busy/error feedback — new Btn component (spinner + inline errors); (4) MARKET_TICK forced full reload every 20s — ticks no longer reload; (5) inspection draft restore missed damages/images — fixed.
Verified by scripted UI-flow: create→accept→start→submit(GREEN 1.74%)→report→PDF→rate(4.8)→feedback(4.67)→settle→analytics/market/ledger/notifications — all pass on the live server. 18/18 automated tests still pass.


## Admin Control Centre upgrade (22/22 PASS)
| # | Test | Result |
|---|---|---|
| 20 | Admin can list every platform user; Bank and Inspector roles receive 403 | ✅ |
| 21 | Overview exposes job, user and ledger distributions for circular charts | ✅ |
| 22 | User status controls work; administrator accounts and self-changes are protected | ✅ |
Frontend build passes. The dark Admin Control Centre includes KPI progress rings, donut charts for job status, valuation flags and user roles, audit queue, user and inspector management, all jobs, payments, AI analytics and allocation settings.

## All-updates pack (26/26 PASS)
| # | Test | Result |
|---|---|---|
| 23 | QR report verification: genuine report verifies publicly without login; fake code 404; QR + code embedded in the full HTML report | ✅ |
| 24 | In-app chat: bank + assigned inspector can message; loan seeker blocked (403) · Live GPS: only the assigned inspector can share location (bank 403), location stored and shown on the job | ✅ |
| 25 | CSV exports (jobs/ledger) download for Admin/Bank, blocked for seeker · Analytics returns 14-day jobs/revenue series and bank-wise performance | ✅ |
New UI: public /verify/:code page, Job Chat inside job details, Share Live Location for inspectors with a live marker + animated route on the Broadcast Map, push-notification pop-ups, Admin Audit Log viewer, Export CSV (Excel) buttons, 14-day activity charts and bank-wise analytics. Frontend build passes.
| 26 | QR code image endpoint serves a real PNG QR for a delivered report (shown in job details + top of full report/PDF), 409 before the report exists | ✅ |
