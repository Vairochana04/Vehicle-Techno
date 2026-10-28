import { fileURLToPath } from 'node:url';
export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'valuation-techno-dev-secret-change-in-production',
  dbPath: process.env.DB_PATH || fileURLToPath(new URL('../data/valuation.db', import.meta.url)),
  uploadDir: fileURLToPath(new URL('../uploads/', import.meta.url)),
  inspectorInstantPay: 1200,
  ratingBonus: 500,
  platformCommissionPct: 20,
  defaultRadiusKm: 25,
  priorityWindowMinutes: 15,
};
export const JOB_STATUS = ['CREATED','VERIFIED','BROADCAST','ASSIGNED','INSPECTION_IN_PROGRESS','INSPECTION_SUBMITTED','AI_ANALYZED','AUDIT_REQUIRED','REPORT_DELIVERED','SETTLED','RE_INSPECTION_REQUIRED','CANCELLED'];
