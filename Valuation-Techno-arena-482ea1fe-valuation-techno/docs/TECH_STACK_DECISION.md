# Technology Stack Decision

## Chosen stack — JavaScript Full-Stack (matches owner's expertise)

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite + React Router | Owner knows Full-Stack JS; fast, component-based dashboards for Bank / Inspector / Seeker / Admin in one responsive web app (works as the "mobile app layer" on phones; offline-cache via service-ready API design). |
| Backend | Node.js 22 + Express (ESM) | Same language end-to-end; huge ecosystem; case-study workflow is CRUD + rules + integrations, not Python-specific. Zero build step = fewer bugs. |
| Database | SQLite via built-in `node:sqlite` | Zero native dependencies, ACID, file-based (easy backup/demo), repository layer allows Postgres swap for production scale. |
| Validation/Auth | Zod + JWT + bcryptjs + OTP endpoint | Every input validated at the boundary; OTP/JWT satisfies Mobile App Layer requirement. |
| File uploads | Multer (images + documents with geo/time metadata) | Geotag/timestamp captured per file for fraud checks. |
| Reports | HTML report + PDF (pdfkit) | Full (bank) & summary (seeker) variants per Phase 5. |
| Testing | Vitest + Supertest | Unit (money/variance/rating math) + full API workflow integration tests; run before every next step. |
| AI/External services | Provider interfaces in `apps/api/src/services/providers/` | Deterministic simulators today (VAHAN, IIB, DeepSearch, killfake.ai, YOLOv8-damage, XGBoost-cost, Razorpay); real keys / Python FastAPI ML microservice drop in later **without touching routes or UI**. |

## Why not Python/FastAPI for the whole product?

- Case study names FastAPI for only 2 internal endpoints; Python is required only *inside* the ML models, which are consumed via APIs.
- Owner has limited Python — a JS codebase they can read, run and maintain is more reliable and bug-free in practice.
- The AI boundary is preserved: `POST /internal/ai/analyze` mirrors the proposed FastAPI contract, so a future Python service can be deployed beside Node with a one-line provider switch (`AI_PROVIDER=python-http`).

## Production migration path (documented, not faked)

SQLite → PostgreSQL · Simulator providers → live VAHAN/IIB/DeepSearch/killfake/Razorpay keys · Monolith → split Python AI microservice. All behind existing interfaces.
