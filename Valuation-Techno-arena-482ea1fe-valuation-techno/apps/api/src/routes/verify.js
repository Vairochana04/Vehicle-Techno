import { Router } from 'express';
import { db } from '../db.js';
import { verifyCodeFor } from '../utils.js';

// Public report verification — anyone with the QR code / link can confirm a
// Valuation Techno report is genuine. No login required, no private data shown.
const r = Router();
r.get('/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const rows = db.prepare(`SELECT j.id, j.regNumber, j.make, j.model, j.year, j.status, v.finalValuation, v.flag, rp.deliveredAt
    FROM jobs j JOIN valuations v ON v.jobId = j.id LEFT JOIN reports rp ON rp.jobId = j.id
    WHERE v.finalValuation IS NOT NULL`).all();
  const job = rows.find((j) => verifyCodeFor(j.id) === code);
  if (!job) return res.status(404).json({ authentic: false, error: 'No genuine report found for this verification code.' });
  res.json({ authentic: true, code, regNumber: job.regNumber, vehicle: `${job.make} ${job.model} (${job.year})`, finalValuation: job.finalValuation, flag: job.flag, status: job.status, deliveredAt: job.deliveredAt || null, message: 'This is a genuine Valuation Techno report.' });
});
export default r;
