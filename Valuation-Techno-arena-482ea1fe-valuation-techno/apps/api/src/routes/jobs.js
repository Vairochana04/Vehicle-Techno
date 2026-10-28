import { Router } from 'express';
import { z } from 'zod';
import PDFDocument from 'pdfkit';
import { db, settings, audit, notify, addLedger, parseJob } from '../db.js';
import { config } from '../config.js';
import { uid, now, round2, clamp, haversineKm, variancePct, isGreen, verifyCodeFor } from '../utils.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
import { verifyVehicle, deepSearchMarketValue, analyzeDamage, analyzeFraud, computePlatformScore } from '../services/providers.js';
import { fullReportHtml, summaryReportHtml } from '../services/report.js';
import { publish } from '../realtime.js';
import QRCode from 'qrcode';

const r = Router(); r.use(requireAuth);
const getJob = (id) => db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
const getInspection = (jobId) => { const i = db.prepare('SELECT * FROM inspections WHERE jobId=?').get(jobId); return i && ({ ...i, condition: JSON.parse(i.conditionJson || '{}'), damages: JSON.parse(i.damagesJson || '[]'), images: JSON.parse(i.imagesJson || '[]'), documents: JSON.parse(i.documentsJson || '[]') }); };
const getValuation = (jobId) => { const v = db.prepare('SELECT * FROM valuations WHERE jobId=?').get(jobId); return v && ({ ...v, varianceReasons: JSON.parse(v.varianceReasonsJson || '[]'), audit: v.auditJson ? JSON.parse(v.auditJson) : null }); };
const getAnalysis = (jobId) => { const a = db.prepare('SELECT * FROM analyses WHERE jobId=?').get(jobId); return a && ({ damage: JSON.parse(a.damageJson), fraud: JSON.parse(a.fraudJson) }); };
function eligibleInspectors(job) {
  return db.prepare("SELECT * FROM users WHERE role='INSPECTOR' AND status!='SUSPENDED'").all()
    .map((u) => ({ ...u, distanceKm: haversineKm(u.lat, u.lng, job.vehicleLat, job.vehicleLng) }))
    .filter((u) => u.distanceKm <= Number(job.broadcastRadiusKm)).sort((a, b) => b.rating - a.rating || a.distanceKm - b.distanceKm);
}
function detail(job) {
  return { ...parseJob(job), inspection: getInspection(job.id), analysis: getAnalysis(job.id), valuation: getValuation(job.id),
    assignedInspector: job.assignedInspectorId ? db.prepare('SELECT id,name,email,phone,rating,ratingCount,status FROM users WHERE id=?').get(job.assignedInspectorId) : null,
    eligibleInspectors: eligibleInspectors(job).map((u) => ({ id: u.id, name: u.name, rating: u.rating, distanceKm: u.distanceKm, status: u.status })),
    rating: db.prepare('SELECT * FROM ratings WHERE jobId=?').get(job.id) || null,
    bankFeedback: (() => { const f = db.prepare('SELECT * FROM bank_feedback WHERE jobId=?').get(job.id); return f ? { ...f, scores: JSON.parse(f.scoresJson) } : null; })(),
    verifyCode: (() => { const v = getValuation(job.id); return v?.finalValuation ? verifyCodeFor(job.id) : null; })(),
    inspectorLocation: job.inspectorLat != null ? { lat: job.inspectorLat, lng: job.inspectorLng, updatedAt: job.locationUpdatedAt } : null,
    ledger: db.prepare('SELECT * FROM ledger WHERE jobId=? ORDER BY createdAt').all(job.id) };
}
export function runPipeline(jobRow, actorId) {
  const job = parseJob(jobRow); const inspection = getInspection(job.id); if (!inspection) throw Object.assign(new Error('Inspection not submitted'), { status: 400 });
  const damage = analyzeDamage(job, inspection); const fraud = analyzeFraud(job, inspection);
  db.prepare('INSERT INTO analyses VALUES(?,?,?,?,?) ON CONFLICT(jobId) DO UPDATE SET damageJson=excluded.damageJson, fraudJson=excluded.fraudJson').run(uid(), job.id, JSON.stringify(damage), JSON.stringify(fraud), now());
  const market = deepSearchMarketValue(job);
  const fraudPenalty = fraud.riskLevel === 'HIGH' ? 0.05 : fraud.riskLevel === 'MEDIUM' ? 0.02 : 0;
  const aiValuation = Math.round((market.marketValue - damage.costBreakdown.totalDamageCost) * (1 - fraudPenalty) / 500) * 500;
  const manual = Number(inspection.manualValuation); const variance = variancePct(manual, aiValuation); const flag = isGreen(variance) ? 'GREEN' : 'RED';
  const reasons = [];
  if (damage.costBreakdown.totalDamageCost > market.marketValue * 0.08) reasons.push(`High AI damage cost ₹${damage.costBreakdown.totalDamageCost} vs manual repair estimate ₹${inspection.manualRepairEstimate || 0}`);
  if (fraud.fraudScore >= 30) reasons.push(`Fraud risk ${fraud.riskLevel} (score ${fraud.fraudScore}) applied ${fraudPenalty * 100}% AI adjustment`);
  if (variance > 5) reasons.push(`Manual ₹${manual} differs from AI ₹${aiValuation} by ${variance}% (threshold 5%)`);
  if (!reasons.length) reasons.push('Manual and AI valuations aligned within tolerance');
  const finalValuation = flag === 'GREEN' ? Math.round(((manual + aiValuation) / 2) / 500) * 500 : null;
  db.prepare('INSERT INTO valuations VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(jobId) DO UPDATE SET marketValue=excluded.marketValue, aiValuation=excluded.aiValuation, manualValuation=excluded.manualValuation, variancePct=excluded.variancePct, flag=excluded.flag, finalValuation=excluded.finalValuation, status=excluded.status, varianceReasonsJson=excluded.varianceReasonsJson')
    .run(uid(), job.id, market.marketValue, aiValuation, manual, variance, flag, finalValuation, flag === 'GREEN' ? 'AUTO_APPROVED' : 'AUDIT_REQUIRED', JSON.stringify(reasons), null, now());
  db.prepare('INSERT INTO reports(id,jobId,createdAt,deliveredAt) VALUES(?,?,?,?) ON CONFLICT(jobId) DO NOTHING').run(uid(), job.id, now(), flag === 'GREEN' ? now() : null);
  const next = flag === 'GREEN' ? 'REPORT_DELIVERED' : 'AUDIT_REQUIRED';
  db.prepare('UPDATE jobs SET status=?, updatedAt=? WHERE id=?').run(next, now(), job.id);
  audit(job.id, actorId, 'AI_PIPELINE_RUN', `${flag} variance ${variance}% AI ₹${aiValuation}`);
  notify(job.bankId, `Valuation ${flag === 'GREEN' ? 'approved' : 'needs audit'}: ${job.regNumber}`, `Variance ${variance}% — ${flag} flag`);
  return getValuation(job.id);
}

// Phase 1 — Bank creates job; verification + broadcast happen synchronously
r.post('/', requireRole('BANK'), wrap(async (req, res) => {
  const b = z.object({ seekerName: z.string().min(2), seekerPhone: z.string().optional(), seekerEmail: z.string().email().optional(), loanRef: z.string().optional(), regNumber: z.string().min(6), make: z.string().min(1), model: z.string().min(1), variant: z.string().optional(), year: z.number().int().min(1990).max(new Date().getFullYear() + 1), fuel: z.enum(['Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid']).optional(), transmission: z.string().optional(), vehicleLat: z.number(), vehicleLng: z.number(), address: z.string().optional(), city: z.string().optional(), pincode: z.string().optional(), expectedOdometer: z.number().int().nonnegative().optional(), valuationFee: z.number().positive().optional(), broadcastRadiusKm: z.number().positive().max(200).optional() }).parse(req.body);
  const verification = verifyVehicle(b);
  if (!verification.verified) return res.status(422).json({ error: 'Vehicle verification failed', verification });
  const id = uid(); const mode = settings.allocationMode; const fee = b.valuationFee || 2500;
  db.prepare(`INSERT INTO jobs(id,bankId,seekerName,seekerPhone,seekerEmail,loanRef,regNumber,make,model,variant,year,fuel,transmission,vehicleLat,vehicleLng,address,city,pincode,expectedOdometer,valuationFee,status,verification,allocationMode,broadcastRadiusKm,priorityUntil,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, b.seekerName, b.seekerPhone || null, b.seekerEmail || null, b.loanRef || null, verification.regNumber, b.make, b.model, b.variant || null, b.year, b.fuel || null, b.transmission || null, b.vehicleLat, b.vehicleLng, b.address || null, b.city || null, b.pincode || null, b.expectedOdometer ?? null, fee, 'BROADCAST', JSON.stringify(verification), mode, b.broadcastRadiusKm || settings.radiusKm, mode === 'RATING_PRIORITY' ? new Date(Date.now() + config.priorityWindowMinutes * 60000).toISOString() : null, now(), now());
  addLedger({ jobId: id, type: 'SEEKER_FEE_TO_BANK', fromParty: b.seekerName, toParty: req.user.bankName || 'Bank', userId: req.user.id, amount: fee, ref: 'seeker-fee' });
  audit(id, req.user.id, 'JOB_CREATED_AND_BROADCAST', `${verification.regNumber} fee ₹${fee} mode ${mode}`);
  eligibleInspectors(getJob(id)).forEach((u) => notify(u.id, `New valuation job near you: ${verification.regNumber}`, `${b.make} ${b.model} · ${u.distanceKm} km away`));
  publish({ type: 'JOB_CREATED', jobId: id, regNumber: verification.regNumber, roles: ['INSPECTOR', 'ADMIN', 'BANK'] });
  res.status(201).json(detail(getJob(id)));
}));
r.get('/', wrap(async (req, res) => {
  let jobs;
  if (req.user.role === 'BANK') jobs = db.prepare('SELECT * FROM jobs WHERE bankId=? ORDER BY createdAt DESC').all(req.user.id);
  else if (req.user.role === 'INSPECTOR') jobs = db.prepare('SELECT * FROM jobs WHERE assignedInspectorId=? OR status=\'BROADCAST\' ORDER BY createdAt DESC').all(req.user.id);
  else if (req.user.role === 'LOAN_SEEKER') jobs = db.prepare('SELECT * FROM jobs WHERE seekerEmail=? OR seekerPhone=? ORDER BY createdAt DESC').all(req.user.email, req.user.phone);
  else jobs = db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all();
  res.json(jobs.map((j) => { const d = detail(j); return req.user.role === 'LOAN_SEEKER' ? { ...d, valuation: d.valuation && ({ flag: d.valuation.flag, finalValuation: d.valuation.finalValuation, variancePct: d.valuation.variancePct, status: d.valuation.status }), analysis: undefined, ledger: undefined } : d; }));
}));
r.get('/:id', wrap(async (req, res) => { const j = getJob(req.params.id); if (!j) return res.status(404).json({ error: 'Job not found' }); res.json(detail(j)); }));

// Phase 1 — Exclusive assignment (atomic: only a BROADCAST job can be claimed)
r.post('/:id/accept', requireRole('INSPECTOR'), wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' });
  if (req.user.status === 'SUSPENDED') return res.status(403).json({ error: 'Suspended inspectors cannot accept jobs. Complete retraining.' });
  const eligible = eligibleInspectors(job); if (!eligible.some((u) => u.id === req.user.id)) return res.status(403).json({ error: `Outside broadcast radius (${job.broadcastRadiusKm} km) or ineligible` });
  if (job.allocationMode === 'RATING_PRIORITY' && job.priorityUntil && new Date(job.priorityUntil) > new Date() && eligible[0]?.id !== req.user.id)
    return res.status(403).json({ error: `Rating-priority window: top-rated inspector ${eligible[0]?.name} has priority until ${job.priorityUntil}` });
  const result = db.prepare("UPDATE jobs SET assignedInspectorId=?, status='ASSIGNED', updatedAt=? WHERE id=? AND status='BROADCAST'").run(req.user.id, now(), job.id);
  if (result.changes === 0) return res.status(409).json({ error: 'Job already assigned to another inspector (exclusive assignment)' });
  audit(job.id, req.user.id, 'JOB_ACCEPTED', req.user.name); notify(job.bankId, `Inspector assigned: ${job.regNumber}`, `${req.user.name} accepted the job`); publish({ type: 'JOB_ASSIGNED', jobId: job.id, regNumber: job.regNumber, inspector: req.user.name, roles: ['BANK', 'ADMIN', 'INSPECTOR'] });
  res.json(detail(getJob(job.id)));
}));
r.post('/:id/start', requireRole('INSPECTOR'), wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!job || job.assignedInspectorId !== req.user.id) return res.status(403).json({ error: 'Only the assigned inspector can start' });
  if (job.status !== 'ASSIGNED') return res.status(409).json({ error: `Cannot start from status ${job.status}` });
  db.prepare("UPDATE jobs SET status='INSPECTION_IN_PROGRESS', updatedAt=? WHERE id=?").run(now(), job.id); audit(job.id, req.user.id, 'INSPECTION_STARTED'); res.json(detail(getJob(job.id)));
}));

// Phase 2 — Inspection submit -> instant pay + AI pipeline (idempotent)
r.post('/:id/inspection', requireRole('INSPECTOR'), wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!job || job.assignedInspectorId !== req.user.id) return res.status(403).json({ error: 'Only the assigned inspector can submit' });
  if (!['ASSIGNED', 'INSPECTION_IN_PROGRESS', 'RE_INSPECTION_REQUIRED'].includes(job.status)) return res.status(409).json({ error: `Inspection cannot be submitted from ${job.status}` });
  const img = z.object({ category: z.enum(['FRONT', 'REAR', 'LEFT', 'RIGHT', 'ENGINE', 'TIRE', 'ODOMETER', 'DAMAGE', 'TOP', 'INTERIOR']), lat: z.number().optional(), lng: z.number().optional(), capturedAt: z.string().optional(), imageHash: z.string().optional(), filename: z.string().optional(), originalName: z.string().optional() });
  const b = z.object({ odometerReading: z.number().int().nonnegative(), chassisNumber: z.string().optional(), condition: z.record(z.number().min(1).max(5)).optional(), damages: z.array(z.object({ part: z.string(), type: z.string(), severity: z.enum(['Small', 'Medium', 'Large']), description: z.string().optional(), repairEstimate: z.number().nonnegative().optional() })).optional(), manualValuation: z.number().positive(), manualRepairEstimate: z.number().nonnegative().optional(), notes: z.string().optional(), images: z.array(img).min(3), documents: z.array(z.object({ type: z.enum(['RC', 'INSURANCE', 'POLLUTION', 'SERVICE_RECORD', 'OTHER']), filename: z.string().optional(), originalName: z.string().optional() })).optional() }).parse(req.body);
  const existing = db.prepare('SELECT id FROM inspections WHERE jobId=?').get(job.id);
  if (existing) return res.status(409).json({ error: 'Inspection already submitted for this job' });
  db.prepare('INSERT INTO inspections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(), job.id, req.user.id, b.odometerReading, b.chassisNumber || null, JSON.stringify(b.condition || {}), JSON.stringify(b.damages || []), b.manualValuation, b.manualRepairEstimate ?? null, b.notes || null, JSON.stringify(b.images), JSON.stringify(b.documents || []), now(), now());
  db.prepare("UPDATE jobs SET status='INSPECTION_SUBMITTED', updatedAt=? WHERE id=?").run(now(), job.id);
  addLedger({ jobId: job.id, type: 'INSPECTOR_INSTANT_PAY', fromParty: 'Valuation Techno', toParty: req.user.name, userId: req.user.id, amount: config.inspectorInstantPay, ref: 'instant-pay' });
  audit(job.id, req.user.id, 'INSPECTION_SUBMITTED_AND_PAID', `Instant pay ₹${config.inspectorInstantPay}`);
  notify(req.user.id, 'Payment received', `₹${config.inspectorInstantPay} instant inspection payment for ${job.regNumber}`);
  let valuation;
  try { valuation = runPipeline(getJob(job.id), req.user.id); }
  catch (e) { // rollback so a pipeline failure never strands a submitted inspection
    db.prepare('DELETE FROM inspections WHERE jobId=?').run(job.id);
    db.prepare("DELETE FROM ledger WHERE jobId=? AND type='INSPECTOR_INSTANT_PAY'").run(job.id);
    db.prepare("UPDATE jobs SET status='INSPECTION_IN_PROGRESS', updatedAt=? WHERE id=?").run(now(), job.id);
    throw e;
  }
  publish({ type: 'VALUATION_READY', jobId: job.id, regNumber: job.regNumber, flag: valuation.flag, variancePct: valuation.variancePct, roles: ['BANK', 'ADMIN', 'INSPECTOR', 'LOAN_SEEKER'] });
  res.status(201).json({ ...detail(getJob(job.id)), valuation });
}));
r.post('/:id/analyze', requireRole('ADMIN', 'BANK'), wrap(async (req, res) => { const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' }); res.json({ valuation: runPipeline(job, req.user.id), ...detail(getJob(job.id)) }); }));

// Phase 4 — Audit for RED flags
r.post('/:id/audit', requireRole('ADMIN'), wrap(async (req, res) => {
  const b = z.object({ action: z.enum(['APPROVE', 'RE_INSPECTION', 'SENIOR_REVIEW']), finalValuation: z.number().positive().optional(), note: z.string().optional() }).parse(req.body);
  const job = getJob(req.params.id); const v = getValuation(req.params.id);
  if (!job || !v || job.status !== 'AUDIT_REQUIRED') return res.status(409).json({ error: 'Job is not awaiting audit' });
  if (b.action === 'RE_INSPECTION') {
    db.prepare("UPDATE jobs SET status='BROADCAST', assignedInspectorId=NULL, updatedAt=? WHERE id=?").run(now(), job.id);
    db.prepare('DELETE FROM inspections WHERE jobId=?').run(job.id); // allow fresh inspection; ledger instant-pay for new inspection uses new ref below via job cycle
    db.prepare("UPDATE ledger SET ref='instant-pay-void' WHERE jobId=? AND type='INSPECTOR_INSTANT_PAY'").run(job.id);
    db.prepare("UPDATE valuations SET status='RE_INSPECTION_REQUIRED' WHERE jobId=?").run(job.id);
    audit(job.id, req.user.id, 'AUDIT_RE_INSPECTION', b.note || ''); return res.json(detail(getJob(job.id)));
  }
  const finalValuation = b.finalValuation || Math.round(((v.manualValuation + v.aiValuation) / 2) / 500) * 500;
  db.prepare("UPDATE valuations SET finalValuation=?, status=?, auditJson=? WHERE jobId=?").run(finalValuation, b.action === 'APPROVE' ? 'AUDIT_APPROVED' : 'SENIOR_REVIEW_APPROVED', JSON.stringify({ by: req.user.id, action: b.action, note: b.note || '', at: now() }), job.id);
  db.prepare("UPDATE jobs SET status='REPORT_DELIVERED', updatedAt=? WHERE id=?").run(now(), job.id);
  db.prepare('UPDATE reports SET deliveredAt=? WHERE jobId=?').run(now(), job.id);
  audit(job.id, req.user.id, 'AUDIT_' + b.action, `Final ₹${finalValuation}`); notify(job.bankId, `Audit approved: ${job.regNumber}`, `Final valuation ₹${finalValuation}`); publish({ type: 'AUDIT_APPROVED', jobId: job.id, regNumber: job.regNumber, finalValuation, roles: ['BANK', 'ADMIN', 'INSPECTOR', 'LOAN_SEEKER'] });
  res.json(detail(getJob(job.id)));
}));


// Live GPS tracking — the assigned inspector shares live location with bank/admin
r.post('/:id/location', requireRole('INSPECTOR'), wrap(async (req, res) => {
  const b = z.object({ lat: z.number(), lng: z.number() }).parse(req.body);
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.assignedInspectorId !== req.user.id) return res.status(403).json({ error: 'Only the assigned inspector can share live location for this job' });
  db.prepare('UPDATE jobs SET inspectorLat=?, inspectorLng=?, locationUpdatedAt=?, updatedAt=? WHERE id=?').run(b.lat, b.lng, now(), now(), job.id);
  publish({ type: 'INSPECTOR_LOCATION', jobId: job.id, regNumber: job.regNumber, lat: b.lat, lng: b.lng, roles: ['BANK', 'ADMIN', 'INSPECTOR'] });
  res.json({ ok: true });
}));

// In-app chat between the bank, the assigned inspector and admin on a job
const canChat = (job, user) => user.role === 'ADMIN' || (user.role === 'BANK' && job.bankId === user.id) || (user.role === 'INSPECTOR' && job.assignedInspectorId === user.id);
r.get('/:id/messages', wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!canChat(job, req.user)) return res.status(403).json({ error: 'You are not part of this job chat' });
  res.json(db.prepare('SELECT * FROM messages WHERE jobId=? ORDER BY createdAt').all(job.id));
}));
r.post('/:id/messages', wrap(async (req, res) => {
  const b = z.object({ body: z.string().min(1).max(1000) }).parse(req.body);
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' });
  if (!canChat(job, req.user)) return res.status(403).json({ error: 'You are not part of this job chat' });
  const sender = db.prepare('SELECT name FROM users WHERE id=?').get(req.user.id);
  const msg = { id: uid(), jobId: job.id, senderId: req.user.id, senderName: sender?.name || req.user.role, senderRole: req.user.role, body: b.body, createdAt: now() };
  db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run(msg.id, msg.jobId, msg.senderId, msg.senderName, msg.senderRole, msg.body, msg.createdAt);
  publish({ type: 'JOB_MESSAGE', jobId: job.id, regNumber: job.regNumber, roles: ['BANK', 'ADMIN', 'INSPECTOR'] });
  res.status(201).json(msg);
}));

// QR code image (PNG) for this job's public report-verification page —
// used directly inside the app (job details) as well as on printed reports.
r.get('/:id/qr', wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' });
  const v = getValuation(job.id); if (!v?.finalValuation) return res.status(409).json({ error: 'Report not ready yet' });
  const url = `${req.protocol}://${req.get('host')}/verify/${verifyCodeFor(job.id)}`;
  const buf = await QRCode.toBuffer(url, { width: 220, margin: 1 });
  res.setHeader('Content-Type', 'image/png'); res.send(buf);
}));

// Phase 5 — Reports (seeker can only see summary; enforced server-side)
r.get('/:id/report', wrap(async (req, res) => {
  const jobRow = getJob(req.params.id); if (!jobRow) return res.status(404).json({ error: 'Job not found' });
  const job = parseJob(jobRow); const valuation = getValuation(job.id); if (!valuation || !valuation.finalValuation) return res.status(409).json({ error: 'Final valuation not ready (audit may be pending)' });
  const variant = req.user.role === 'LOAN_SEEKER' ? 'summary' : (req.query.variant === 'summary' ? 'summary' : 'full');
  let verify = null;
  if (variant === 'full') { const code = verifyCodeFor(job.id); const url = `${req.protocol}://${req.get('host')}/verify/${code}`; let qrDataUrl = null; try { qrDataUrl = await QRCode.toDataURL(url, { width: 160, margin: 1 }); } catch { /* QR optional */ } verify = { code, url, qrDataUrl }; }
  const data = { job, inspection: getInspection(job.id), analysis: getAnalysis(job.id), valuation, verify };
  res.type('html').send(variant === 'summary' ? summaryReportHtml(data) : fullReportHtml(data));
}));
r.get('/:id/report.pdf', wrap(async (req, res) => {
  const jobRow = getJob(req.params.id); if (!jobRow) return res.status(404).json({ error: 'Job not found' });
  const job = parseJob(jobRow); const v = getValuation(job.id); if (!v?.finalValuation) return res.status(409).json({ error: 'Final valuation not ready' });
  const variant = req.user.role === 'LOAN_SEEKER' ? 'summary' : (req.query.variant === 'summary' ? 'summary' : 'full');
  const doc = new PDFDocument(); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="valuation-${job.regNumber}-${variant}.pdf"`); doc.pipe(res);
  doc.fontSize(18).text('Valuation Techno — Valuation Report'); doc.moveDown().fontSize(12).text(`${job.make} ${job.model} (${job.year}) · ${job.regNumber}`).text(`Final Valuation: INR ${v.finalValuation}`).text(`Flag: ${v.flag} · Variance: ${v.variancePct}%`);
  if (variant === 'full') { doc.text(`AI Valuation: INR ${v.aiValuation} · Manual: INR ${v.manualValuation} · Market: INR ${v.marketValue}`); const a = getAnalysis(job.id); if (a) doc.text(`Damage total: INR ${a.damage.costBreakdown.totalDamageCost} · Fraud: ${a.fraud.riskLevel} (${a.fraud.fraudScore}/100)`); }
  if (variant === 'full') { try { const code = verifyCodeFor(job.id); const url = `${req.protocol}://${req.get('host')}/verify/${code}`; const buf = await QRCode.toBuffer(url, { width: 140, margin: 1 }); doc.moveDown().fontSize(13).text('Verify This Report'); doc.image(buf, { width: 110 }); doc.fontSize(10).text(`Verification Code: ${code}`).text(url); } catch { /* QR optional */ } }
  doc.text('Generated by Valuation Techno · Smart Valuation. Safer Transactions.'); doc.end();
}));

// Phase 5 — Rating: Final = 0.4 seeker + 0.6 platform
r.post('/:id/rate', requireRole('LOAN_SEEKER', 'BANK'), wrap(async (req, res) => {
  const b = z.object({ professionalism: z.number().min(1).max(5), punctuality: z.number().min(1).max(5), communication: z.number().min(1).max(5), thoroughness: z.number().min(1).max(5), feedback: z.string().optional() }).parse(req.body);
  const job = getJob(req.params.id); if (!job?.assignedInspectorId) return res.status(409).json({ error: 'No inspector assigned' });
  if (!['REPORT_DELIVERED', 'SETTLED'].includes(job.status)) return res.status(409).json({ error: 'Rating opens after report delivery' });
  if (db.prepare('SELECT id FROM ratings WHERE jobId=?').get(job.id)) return res.status(409).json({ error: 'Already rated' });
  const v = getValuation(job.id); const a = getAnalysis(job.id); const insp = getInspection(job.id);
  const seekerScore = round2((b.professionalism + b.punctuality + b.communication + b.thoroughness) / 4);
  const platformScore = computePlatformScore({ variance: v.variancePct, fraudScore: a.fraud.fraudScore, imagesCount: insp.images.length, docsCount: insp.documents.length });
  const composite = round2(0.4 * seekerScore + 0.6 * platformScore);
  db.prepare('INSERT INTO ratings VALUES(?,?,?,?,?,?,?,?,?)').run(uid(), job.id, job.assignedInspectorId, JSON.stringify(b), seekerScore, platformScore, composite, b.feedback || null, now());
  const ins = db.prepare('SELECT * FROM users WHERE id=?').get(job.assignedInspectorId);
  const count = ins.ratingCount + 1; const sum = round2(ins.ratingSum + composite); const avg = round2(sum / count);
  const status = count >= 3 && avg < 2 ? 'SUSPENDED' : count >= 3 && avg < 2.5 ? 'RETRAINING' : 'ACTIVE';
  db.prepare('UPDATE users SET rating=?, ratingCount=?, ratingSum=?, status=? WHERE id=?').run(avg, count, sum, status, ins.id);
  if (composite >= 4.5) addLedger({ jobId: job.id, type: 'INSPECTOR_BONUS', fromParty: 'Valuation Techno', toParty: ins.name, userId: ins.id, amount: config.ratingBonus, ref: 'rating-bonus' });
  audit(job.id, req.user.id, 'INSPECTOR_RATED', `seeker ${seekerScore} platform ${platformScore} composite ${composite} status ${status}`);
  notify(ins.id, 'New rating received', `Composite ${composite}/5 · Overall ${avg}/5 (${status})`); publish({ type: 'INSPECTOR_RATED', jobId: job.id, regNumber: job.regNumber, composite, roles: ['INSPECTOR', 'ADMIN', 'BANK'] });
  res.status(201).json({ seekerScore, platformScore, composite, inspectorRating: avg, inspectorStatus: status });
}));

// Phase 5 — Bank feedback (report quality signal; composite formula stays seeker+platform per case study)
r.post('/:id/bank-feedback', requireRole('BANK'), wrap(async (req, res) => {
  const b = z.object({ reportQuality: z.number().min(1).max(5), timeliness: z.number().min(1).max(5), accuracy: z.number().min(1).max(5), comment: z.string().optional() }).parse(req.body);
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.bankId !== req.user.id) return res.status(403).json({ error: 'Only the owning bank can give feedback on this job' });
  if (!['REPORT_DELIVERED', 'SETTLED'].includes(job.status)) return res.status(409).json({ error: 'Feedback opens after report delivery' });
  if (db.prepare('SELECT id FROM bank_feedback WHERE jobId=?').get(job.id)) return res.status(409).json({ error: 'Bank feedback already submitted' });
  const avgScore = round2((b.reportQuality + b.timeliness + b.accuracy) / 3);
  db.prepare('INSERT INTO bank_feedback VALUES(?,?,?,?,?,?,?)').run(uid(), job.id, req.user.id, JSON.stringify(b), avgScore, b.comment || null, now());
  if (avgScore <= 2) db.prepare("SELECT id FROM users WHERE role='ADMIN'").all().forEach((a) => notify(a.id, `Low bank feedback on ${job.regNumber}`, `Bank scored this report ${avgScore}/5 — review recommended`));
  audit(job.id, req.user.id, 'BANK_FEEDBACK', `avg ${avgScore}/5`);
  res.status(201).json({ avgScore });
}));

// Phase 6 — Settlement (idempotent; only after report delivery)
r.post('/:id/settle', requireRole('BANK', 'ADMIN'), wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'SETTLED') return res.status(409).json({ error: 'Already settled' });
  if (job.status !== 'REPORT_DELIVERED') return res.status(409).json({ error: `Settlement requires REPORT_DELIVERED, found ${job.status}` });
  const fee = Number(job.valuationFee); const commission = round2(fee * config.platformCommissionPct / 100);
  addLedger({ jobId: job.id, type: 'BANK_TO_PLATFORM', fromParty: 'Bank', toParty: 'Valuation Techno', userId: job.bankId, amount: fee, ref: 'bank-settlement' });
  addLedger({ jobId: job.id, type: 'PLATFORM_COMMISSION', fromParty: 'Valuation Techno', toParty: 'Platform', amount: commission, ref: 'commission' });
  addLedger({ jobId: job.id, type: 'PROVIDER_MARGIN', fromParty: 'Valuation Techno', toParty: 'Service Provider', amount: round2(fee - commission), ref: 'margin' });
  db.prepare("UPDATE jobs SET status='SETTLED', updatedAt=? WHERE id=?").run(now(), job.id);
  audit(job.id, req.user.id, 'SETTLED', `fee ₹${fee} commission ₹${commission}`); publish({ type: 'SETTLED', jobId: job.id, regNumber: job.regNumber, amount: fee, roles: ['BANK', 'ADMIN', 'INSPECTOR'] });
  res.json(detail(getJob(job.id)));
}));
export { detail, getJob };
export default r;
