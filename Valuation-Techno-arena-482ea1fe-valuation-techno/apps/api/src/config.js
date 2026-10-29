import { fileURLToPath } from 'node:url';

const DEFAULT_DEV_JWT_SECRET = 'valuation-techno-dev-secret-change-in-production';
const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || DEFAULT_DEV_JWT_SECRET;

// Fail early rather than silently booting production with demo-grade secrets or
// an ephemeral/default database path that could lose real customer records.
if (isProduction) {
  if (!process.env.JWT_SECRET || jwtSecret === DEFAULT_DEV_JWT_SECRET || jwtSecret.length < 32) {
    throw new Error('Production requires a private JWT_SECRET of at least 32 characters. Configure it in the hosting provider; do not put it in source control.');
  }
  if (!process.env.DB_PATH) {
    throw new Error('Production requires DB_PATH to point to persistent storage.');
  }
  if (!process.env.CORS_ORIGIN) {
    throw new Error('Production requires CORS_ORIGIN to be set to the portal origin.');
  }
}

export const config = {
  isProduction,
  port: Number(process.env.PORT || 4000),
  jwtSecret,
  dbPath: process.env.DB_PATH || fileURLToPath(new URL('../data/valuation.db', import.meta.url)),
  uploadDir: process.env.UPLOAD_DIR || fileURLToPath(new URL('../uploads/', import.meta.url)),
  inspectorInstantPay: 1200,
  ratingBonus: 500,
  platformCommissionPct: 20,
  defaultRadiusKm: 25,
  priorityWindowMinutes: 15,
};
export const JOB_STATUS = ['CREATED','VERIFIED','BROADCAST','ASSIGNED','INSPECTION_IN_PROGRESS','INSPECTION_SUBMITTED','AI_ANALYZED','AUDIT_REQUIRED','REPORT_DELIVERED','SETTLED','RE_INSPECTION_REQUIRED','CANCELLED'];
