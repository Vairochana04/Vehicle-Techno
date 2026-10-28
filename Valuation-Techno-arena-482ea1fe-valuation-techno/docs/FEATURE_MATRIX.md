# Feature Matrix — PDF requirement → implementation

Legend: ✅ Real & working in-app · 🔌 Interface-ready (live vendor key swaps the deterministic provider, no code redesign)

| PDF item | Status | Where |
|---|---|---|
| 1 Loan seeker pays fee to bank | ✅ | `SEEKER_FEE_TO_BANK` ledger on job creation |
| 2 Bank creates job (vehicle+owner) | ✅ | Bank Phase-1 form → `POST /jobs` |
| 3 RC/insurance/ownership/accident/claim API verification | 🔌 | VAHAN+IIB provider `verifyVehicle()` |
| 4 Broadcast within radius | ✅ + real-time | Haversine eligibility + instant WebSocket `JOB_CREATED` |
| 5 First-accept exclusive | ✅ | Atomic `BROADCAST→ASSIGNED`, second accept 409 (tested) |
| 6 Rating-based allocation evolution | ✅ | Admin toggle FIRST_COME / RATING_PRIORITY + priority window |
| 7–8 Inspector travel + geotagged/timestamped photos | ✅ | Live GPS button, Device Camera API capture, upload w/ hash |
| 9 Documents RC/insurance/pollution/service | ✅ | Document capture + inspection payload |
| 10 Manual report (condition/damage/repair) | ✅ | Inspection form (condition, damages, estimates) |
| 11 Instant on-site inspector payment | ✅ | ₹1,200 ledger exactly-once per cycle (tested) |
| 12 AI dents/scratches/rust/tire + parts/labor/paint | 🔌 | Damage provider + animated AI Vision Scan + Digital Twin hotspots |
| 13 killfake deepfake/metadata/tamper (odo/chassis/docs) | 🔌 | 6 fraud checks + animated Fraud Gauge |
| 14 Fraud feeds valuation adjustment | ✅ | HIGH −5% / MEDIUM −2% AI adjustment |
| 15 DeepSearch dynamic pricing | 🔌 | Market provider + live trend/forecast/comparables chart |
| 16 Manual vs AI comparison | ✅ | Dual valuation table |
| 17 Green ≤5% average/auto · Red >5% audit/re-inspect/senior | ✅ | Both paths + re-inspection tested end-to-end |
| 18 Variance reasons | ✅ | Variance report (damage/fraud/market reasons) |
| 19 Full report content (dual/damage/fraud/images/history) | ✅ | HTML + PDF, annotated detections |
| 20 Bank full / seeker summary delivery | ✅ | Server-enforced summary privacy (tested) |
| 21–22 Seeker + platform rating, 0.4/0.6 composite, bonus/retrain/suspend | ✅ | Rating engine + leaderboard + status automation |
| 23–25 Inspector pay / bank settlement / commission+margin / audit trail | ✅ | Razorpay-style ledger (20/80 split), idempotent, audit log |
| Mobile layer: OTP/JWT, push, offline SQLite cache | ✅ | OTP+JWT, WebSocket push + notifications, offline drafts + SQLite DB |
| APIs named: Maps geo, Payment gateway, SMS/push (Twilio/Firebase) | 🔌 | Browser Geo/Camera APIs real; gateway/notification providers interface-ready |
| AI models: YOLOv8, Mask R-CNN, XGBoost, killfake, LR ensemble, DT/SVM scoring | 🔌 | Deterministic simulators behind the exact model contracts (Python FastAPI swap-in documented) |

| QR-verified reports + public verification page | ✅ | `verifyCodeFor` + `qrcode`, QR in HTML & PDF reports, `/verify/:code` |
| Audit Log viewer (Admin) | ✅ | `/admin/audit-log` + Audit Log section in Admin Control Centre |
| Live inspector GPS tracking | ✅ | `POST /jobs/:id/location`, live marker + animated route on LiveMap |
| In-app job chat (Bank · Inspector · Admin) | ✅ | `messages` table + `/jobs/:id/messages`, ChatBox in job details |
| Push-notification pop-ups | ✅ | WebSocket events -> toast stack on every dashboard |
| 14-day activity charts + bank-wise analytics | ✅ | `/analytics` series + banks, charts in Analytics panel |
| Excel-ready CSV exports (jobs & ledger) | ✅ | `/admin/export/*.csv` + download buttons |

**Creative/advanced additions:** real-time WebSocket dashboards with live activity feed, vehicle Digital Twin with pulsing damage hotspots, AI scan animation, animated fraud gauge, DeepSearch market forecast chart, live broadcast map, AI analytics (fraud distribution, variance health, volume forecast), count-up KPIs, camera/GPS capture, offline inspection drafts.
**Honest boundary:** without paid vendor keys, external registries (VAHAN/IIB/Razorpay/Twilio) and ML models run as deterministic providers — the *product behaviour* (rules, money, states, security, real-time sync, multi-user roles) is fully real, persisted, and tested.
