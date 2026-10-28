# Valuation Techno — Complete Case Study Analysis

> Source: `Valuation Techno - Technical Proposal.pdf` (8 pages) — read & analyzed end-to-end.
> Product tagline: *Smart Valuation. Safer Transactions* — India's AI-powered Used Vehicle Valuation & FinTech platform (killfake.ai deepfake/fraud detection).

## 1. Business workflow (6 phases, 25 steps)

| Phase | Steps | What must happen |
|---|---|---|
| 1. Loan & Job Creation | 1–6 | Loan seeker pays valuation fee to bank → bank creates job (vehicle + owner) → system verifies RC / insurance / ownership / accident / claim history via APIs → job broadcast to inspectors in radius → **first acceptor gets exclusive assignment** → later evolves to **rating-priority allocation**. |
| 2. On-Site Inspection | 7–11 | Inspector travels → geotagged+timestamped photos (exterior, engine bay, tires, odometer, damages) → documents (RC, insurance, pollution cert, service records) → manual valuation report (condition ratings, damage notes, repair estimates) → **instant on-site payment on submit**. |
| 3. AI Damage & Fraud | 12–14 | Vision AI: dents/scratches/rust/tire wear + parts/labor/paint cost → Killfake.ai: image comparison, metadata verification, tampering checks (odometer, chassis, documents) → fraud confidence feeds valuation adjustment. |
| 4. Dual Valuation & Variance | 15–18 | DeepSearch market price adjusted by damage/fraud → manual vs AI compared → **Green ≤ 5% (auto-approve, final = average)** / **Red > 5% (audit, re-inspection or senior review)** → variance report with reasons. Only Red/Green flags (no yellow). |
| 5. Report & Rating | 19–22 | Full report (bank) + summary (loan seeker): dual valuations+flag, damage breakdown, fraud risk, annotated geotagged images, accident/claim history → seeker rates professionalism/punctuality/communication/thoroughness → platform accuracy score → **Final Rating = 0.4×Seeker + 0.6×Platform** → high: better allocation+bonus, low: retraining/suspension. |
| 6. Payments & Settlement | 23–25 | Inspector paid instantly → bank pays provider per approved report → platform commission + provider margin settled after approval → full audit trail & transaction logs. |

## 2. Modules (must all exist)

Job Management · Inspection · AI Analysis (damage + fraud) · Valuation Engine · Report & Rating · Payment & Settlement · Mobile App Layer (OTP/JWT auth, push notifications, offline cache concept).

## 3. APIs & AI models named in the case study

- External: VAHAN/Parivahan RC, IIB insurance & claims, ownership verification, Google Maps/Mapbox geo, DeepSearch pricing, Razorpay/Stripe/Cashfree payments, Firebase/Twilio notifications.
- AI: YOLOv8/EfficientDet (damage detection), Mask R-CNN/U-Net (segmentation), XGBoost/LightGBM (repair cost), killfake.ai (fraud/deepfake), Linear Regression/Ensemble (valuation adjustment), Decision Tree/SVM (inspector accuracy), ±5% variance engine.

## 4. Tech-stack decision (see TECH_STACK_DECISION.md)

The proposal mentions FastAPI only for 2 internal endpoints (document upload, internal AI analysis). All named AI models are Python, but they sit **behind APIs** — the product itself is a workflow/FinTech platform. Decision: **JavaScript Full-Stack (React + Node/Express + SQLite)** matching the owner's Full-Stack expertise, with every AI/external system implemented as a **provider-interface service** (`services/providers/`) so the real Python ML microservice (YOLOv8 / killfake.ai / XGBoost) or live vendor APIs can replace the deterministic simulators without changing any product code. No requirement needs Python in the product layer.

## 5. Roles

Bank (creates jobs, full report, settles) · Inspector (accepts, inspects, manual valuation, earnings) · Loan Seeker (summary report, rates inspector) · Admin/Platform (audit queue, ratings governance, ledger, allocation-mode control).

## 6. Non-negotiables encoded as rules & tests

1. Exclusive assignment — second accept on an assigned job must fail (atomic).
2. Radius broadcast — only inspectors within radius are eligible.
3. Instant inspector payment exactly once per submitted inspection.
4. Variance math: `|manual − AI| / AI × 100`; Green ≤ 5 → average + auto-approve; Red > 5 → audit required before report settlement.
5. Composite rating exactly `0.4 / 0.6`; retraining/suspension thresholds enforced in allocation.
6. Money never double-settles; every movement writes a ledger + audit entry.
7. Full vs summary report — summary must not expose AI internals/inspector payout.
