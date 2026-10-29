import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
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
const getLoanDecision = (jobId) => db.prepare('SELECT id,jobId,bankId,decision,note,decidedAt FROM loan_decisions WHERE jobId=? ORDER BY decidedAt DESC,id DESC LIMIT 1').get(jobId) || null;
const getLoanDecisionHistory = (jobId) => db.prepare('SELECT id,decision,note,decidedAt FROM loan_decisions WHERE jobId=? ORDER BY decidedAt,id').all(jobId);
function eligibleInspectors(job) {
  return db.prepare("SELECT * FROM users WHERE role='INSPECTOR' AND status!='SUSPENDED'").all()
    .map((u) => ({ ...u, distanceKm: haversineKm(u.lat, u.lng, job.vehicleLat, job.vehicleLng) }))
    .filter((u) => u.distanceKm <= Number(job.broadcastRadiusKm)).sort((a, b) => b.rating - a.rating || a.distanceKm - b.distanceKm);
}
function canAccessJob(job, user) {
  if (!job || !user) return false;
  if (user.role === 'ADMIN') return true;
  if (user.role === 'BANK') return job.bankId === user.id;
  if (user.role === 'LOAN_SEEKER') return (job.seekerEmail && job.seekerEmail.toLowerCase() === String(user.email || '').toLowerCase()) || (job.seekerPhone && job.seekerPhone === user.phone);
  if (user.role === 'INSPECTOR') return job.assignedInspectorId === user.id || (job.status === 'BROADCAST' && eligibleInspectors(job).some((inspector) => inspector.id === user.id));
  return false;
}
function ensureJobAccess(job, user, res) {
  if (canAccessJob(job, user)) return true;
  res.status(404).json({ error: 'Job not found' });
  return false;
}
export const mediaBaseUrl = (req) => {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const first = (value) => String(value || '').split(',')[0].trim();
  const proto = first(req.get('x-forwarded-proto') || req.protocol).replace(/:$/, '');
  const host = first(req.get('x-forwarded-host') || req.get('host'));
  return `${proto}://${host}`;
};
function detail(job) {
  return { ...parseJob(job), inspection: getInspection(job.id), analysis: getAnalysis(job.id), valuation: getValuation(job.id),
    assignedInspector: job.assignedInspectorId ? db.prepare('SELECT id,name,email,phone,rating,ratingCount,status FROM users WHERE id=?').get(job.assignedInspectorId) : null,
    eligibleInspectors: eligibleInspectors(job).map((u) => ({ id: u.id, name: u.name, rating: u.rating, distanceKm: u.distanceKm, status: u.status })),
    rating: db.prepare('SELECT * FROM ratings WHERE jobId=?').get(job.id) || null,
    bankFeedback: (() => { const f = db.prepare('SELECT * FROM bank_feedback WHERE jobId=?').get(job.id); return f ? { ...f, scores: JSON.parse(f.scoresJson) } : null; })(),
    loanDecision: getLoanDecision(job.id),
    loanDecisionHistory: getLoanDecisionHistory(job.id),
    verifyCode: (() => { const v = getValuation(job.id); return v?.finalValuation ? verifyCodeFor(job.id) : null; })(),
    inspectorLocation: job.inspectorLat != null ? { lat: job.inspectorLat, lng: job.inspectorLng, updatedAt: job.locationUpdatedAt } : null,
    ledger: db.prepare('SELECT * FROM ledger WHERE jobId=? ORDER BY createdAt').all(job.id) };
}
const seekerView = (jobDetail) => ({ ...jobDetail, bankId: undefined, assignedInspectorId: undefined, allocationMode: undefined, priorityUntil: undefined,
  verification: undefined, inspection: undefined, analysis: undefined, eligibleInspectors: undefined, ledger: undefined, bankFeedback: undefined, loanDecision: undefined, loanDecisionHistory: undefined,
  assignedInspector: jobDetail.assignedInspector ? { id: jobDetail.assignedInspector.id, name: jobDetail.assignedInspector.name, rating: jobDetail.assignedInspector.rating, status: jobDetail.assignedInspector.status } : null,
  valuation: jobDetail.valuation && ({ flag: jobDetail.valuation.flag, finalValuation: jobDetail.valuation.finalValuation, variancePct: jobDetail.valuation.variancePct, status: jobDetail.valuation.status }) });
const participantView = (jobDetail, user) => user.role === 'LOAN_SEEKER' ? seekerView(jobDetail) : user.role === 'INSPECTOR' ? ({ ...jobDetail, loanDecision: undefined, loanDecisionHistory: undefined }) : jobDetail;
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
  else if (req.user.role === 'INSPECTOR') jobs = db.prepare('SELECT * FROM jobs WHERE assignedInspectorId=? OR status=\'BROADCAST\' ORDER BY createdAt DESC').all(req.user.id).filter((job) => job.assignedInspectorId === req.user.id || eligibleInspectors(job).some((inspector) => inspector.id === req.user.id));
  else if (req.user.role === 'LOAN_SEEKER') jobs = db.prepare('SELECT * FROM jobs WHERE seekerEmail=? OR seekerPhone=? ORDER BY createdAt DESC').all(req.user.email, req.user.phone);
  else jobs = db.prepare('SELECT * FROM jobs ORDER BY createdAt DESC').all();
  res.json(jobs.map((job) => participantView(detail(job), req.user)));
}));
r.get('/:id', wrap(async (req, res) => { const job = getJob(req.params.id); if (!ensureJobAccess(job, req.user, res)) return; res.json(participantView(detail(job), req.user)); }));

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
  db.prepare("UPDATE jobs SET status='INSPECTION_IN_PROGRESS', updatedAt=? WHERE id=?").run(now(), job.id);
  audit(job.id, req.user.id, 'INSPECTION_STARTED');
  publish({ type: 'INSPECTION_STARTED', jobId: job.id, regNumber: job.regNumber, inspector: req.user.name, roles: ['BANK', 'ADMIN', 'INSPECTOR'] });
  res.json(detail(getJob(job.id)));
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
r.post('/:id/analyze', requireRole('ADMIN', 'BANK'), wrap(async (req, res) => { const job = getJob(req.params.id); if (!ensureJobAccess(job, req.user, res)) return; res.json({ valuation: runPipeline(job, req.user.id), ...detail(getJob(job.id)) }); }));

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
    audit(job.id, req.user.id, 'AUDIT_RE_INSPECTION', b.note || '');
    publish({ type: 'RE_INSPECTION_BROADCAST', jobId: job.id, regNumber: job.regNumber, roles: ['BANK', 'ADMIN', 'INSPECTOR'] });
    return res.json(detail(getJob(job.id)));
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

// Private inspection evidence: only job participants can open attached files.
r.get('/:id/files/:filename', wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!ensureJobAccess(job, req.user, res)) return;
  const filename = path.basename(req.params.filename || '');
  if (!filename || filename !== req.params.filename) return res.status(404).json({ error: 'File not found' });
  const inspection = getInspection(job.id);
  const photo = (inspection?.images || []).find((item) => item.filename === filename);
  const document = (inspection?.documents || []).find((item) => item.filename === filename);
  // Loan seekers may view only the actual uploaded FRONT photo in their summary, never inspection documents.
  if (req.user.role === 'LOAN_SEEKER' && photo?.category !== 'FRONT') return res.status(404).json({ error: 'File not found' });
  if (!photo && !document) return res.status(404).json({ error: 'File not found' });
  const uploadRoot = path.resolve(config.uploadDir);
  const filePath = path.resolve(uploadRoot, filename);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`) || !fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.sendFile(filePath);
}));

// QR image for a delivered report. The image is only available to users who can access this job.
r.get('/:id/qr', wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!ensureJobAccess(job, req.user, res)) return;
  const v = getValuation(job.id); if (!v?.finalValuation) return res.status(409).json({ error: 'Report not ready yet' });
  const url = `${mediaBaseUrl(req)}/verify/${verifyCodeFor(job.id)}`;
  const buf = await QRCode.toBuffer(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
  res.setHeader('Content-Type', 'image/png'); res.send(buf);
}));

// Phase 5 — Full report for the owning bank/admin/assigned inspector; summary for the linked seeker.
r.get('/:id/report', wrap(async (req, res) => {
  const jobRow = getJob(req.params.id); if (!ensureJobAccess(jobRow, req.user, res)) return;
  const job = parseJob(jobRow); const valuation = getValuation(job.id); if (!valuation || !valuation.finalValuation) return res.status(409).json({ error: 'Final valuation not ready (audit may be pending)' });
  const variant = req.user.role === 'LOAN_SEEKER' ? 'summary' : (req.query.variant === 'summary' ? 'summary' : 'full');
  const code = verifyCodeFor(job.id); const url = `${mediaBaseUrl(req)}/verify/${code}`;
  let qrDataUrl = null; try { qrDataUrl = await QRCode.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' }); } catch { /* QR optional; verification link remains available */ }
  const verify = { code, url, qrDataUrl };
  const data = { job, inspection: getInspection(job.id), analysis: getAnalysis(job.id), valuation, verify, mediaBaseUrl: mediaBaseUrl(req) };
  res.type('html').send(variant === 'summary' ? summaryReportHtml(data) : fullReportHtml(data));
}));
r.get('/:id/report.pdf', wrap(async (req, res) => {
  const jobRow = getJob(req.params.id); if (!ensureJobAccess(jobRow, req.user, res)) return;
  const job = parseJob(jobRow); const valuation = getValuation(job.id); if (!valuation?.finalValuation) return res.status(409).json({ error: 'Final valuation not ready' });
  const variant = req.user.role === 'LOAN_SEEKER' ? 'summary' : (req.query.variant === 'summary' ? 'summary' : 'full');
  const inspection = getInspection(job.id); const analysis = getAnalysis(job.id);
  const doc = new PDFDocument({ margin: 44, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="valuation-${job.regNumber}-${variant}.pdf"`); doc.pipe(res);
  const section = (title) => { if (doc.y > 690) doc.addPage(); doc.moveDown(0.7).fontSize(14).fillColor('#163c5a').text(title); doc.moveDown(0.25).fillColor('#18314a').fontSize(10); };
  doc.fontSize(22).fillColor('#163c5a').text('Valuation Techno'); doc.moveDown(0.2).fontSize(16).text(variant === 'summary' ? 'Vehicle valuation summary' : 'Full vehicle valuation report');
  doc.moveDown().fontSize(11).fillColor('#18314a').text(`${job.make} ${job.model} ${job.variant || ''} (${job.year}) · ${job.regNumber}`)
    .text(`Loan reference: ${job.loanRef || '—'} · Owner: ${job.seekerName || '—'} · City: ${job.city || '—'}`)
    .text(`Final valuation: INR ${valuation.finalValuation} · Flag: ${valuation.flag} · Variance: ${valuation.variancePct}%`);
  if (variant === 'summary') {
    doc.moveDown().text('Inspection status: Inspection completed');
    doc.moveDown().text('This is the vehicle valuation summary. The bank will make the final loan decision separately.');
    const code = verifyCodeFor(job.id); const url = `${mediaBaseUrl(req)}/verify/${code}`;
    doc.moveDown().fontSize(12).fillColor('#163c5a').text('Scan to verify report');
    try { const qr = await QRCode.toBuffer(url, { width: 320, margin: 2, errorCorrectionLevel: 'M' }); doc.image(qr, { width: 112 }); }
    catch { /* the verification link remains available if QR generation fails */ }
    doc.moveDown(0.3).fontSize(9).fillColor('#18314a').text(`Verification code: ${code}`);
    doc.fillColor('#2563eb').text('Open public verification page', { link: url, underline: true });
    doc.moveDown().fillColor('#61758a').text(`Generated ${new Date().toLocaleString('en-IN')} · Valuation Techno`);
    doc.end(); return;
  }

  section('Vehicle details and registry verification');
  doc.text(`Fuel: ${job.fuel || '—'} · Transmission: ${job.transmission || '—'} · Location: ${job.address || '—'}, ${job.city || '—'} ${job.pincode || ''}`)
    .text(`Expected odometer: ${job.expectedOdometer ?? '—'} km · Owners: ${job.verification?.ownership?.ownersCount ?? job.verification?.ownership?.owners ?? '—'}`)
    .text(`Accidents: ${job.verification?.history?.accidentCount ?? job.verification?.history?.accidents ?? '—'} · Claims: ${job.verification?.history?.claimCount ?? job.verification?.history?.claims ?? '—'} · Insurance valid: ${job.verification?.insurance?.valid ? 'Yes' : 'No'}`);
  for (const check of job.verification?.checks || []) doc.text(`${check.name}: ${check.status} — ${check.detail}`);

  section('Dual valuation and variance');
  doc.text(`Market estimate: INR ${valuation.marketValue} · System estimate: INR ${valuation.aiValuation} · Inspector valuation: INR ${valuation.manualValuation}`)
    .text(`Reasons: ${(valuation.varianceReasons || []).join('; ') || '—'}`);

  section('Inspector condition and notes');
  const condition = inspection?.condition || {};
  doc.text(`Engine: ${condition.engine ?? '—'}/5 · Body: ${condition.body ?? '—'}/5 · Tyres: ${condition.tires ?? '—'}/5 · Interior: ${condition.interior ?? '—'}/5`)
    .text(`Odometer reading: ${inspection?.odometerReading ?? '—'} km · Chassis: ${inspection?.chassisNumber || '—'}`)
    .text(`Manual repair estimate: INR ${inspection?.manualRepairEstimate ?? 0} · Notes: ${inspection?.notes || '—'}`);

  section('AI damage estimate and cost breakdown');
  if (analysis) {
    doc.text(`Damage total: INR ${analysis.damage.costBreakdown.totalDamageCost} · Parts: INR ${analysis.damage.costBreakdown.parts} · Labour: INR ${analysis.damage.costBreakdown.labor} · Paint: INR ${analysis.damage.costBreakdown.paint} · Tyre wear: ${analysis.damage.tireWearPct}%`);
    for (const item of analysis.damage.detections || []) doc.text(`• ${item.part}: ${item.type}, ${item.severity}, ${Math.round((item.confidence || 0) * 100)}% confidence — INR ${item.estimatedCost}`);
    if (!(analysis.damage.detections || []).length) doc.text('No system damage annotations recorded.');
    doc.moveDown(0.4).text('Inspector-recorded damage:');
    for (const item of inspection?.damages || []) doc.text(`• ${item.part}: ${item.type}, ${item.severity} — ${item.description || 'No description'} · repair INR ${item.repairEstimate ?? 0}`);
  } else doc.text('No automated damage analysis available.');

  section('Fraud risk assessment');
  if (analysis) {
    doc.text(`Risk: ${analysis.fraud.riskLevel} · Score: ${analysis.fraud.fraudScore}/100`);
    for (const check of analysis.fraud.checks || []) doc.text(`${check.name}: ${check.status} — ${check.detail}`);
  } else doc.text('No fraud checks recorded.');

  section('Inspection photos and location evidence');
  const photos = (inspection?.images || []).filter((image) => image.filename);
  if (!photos.length) doc.text('No uploaded photo files are attached; metadata-only inspection records may be present.');
  for (const image of photos) {
    if (doc.y > 600) doc.addPage();
    doc.moveDown(0.3).fontSize(10).text(`${image.category} · ${image.originalName || image.filename} · ${image.capturedAt || 'time not recorded'} · GPS ${image.lat ?? '—'}, ${image.lng ?? '—'}`);
    const imagePath = path.join(config.uploadDir, path.basename(image.filename));
    const ext = path.extname(image.originalName || image.filename).toLowerCase();
    if (fs.existsSync(imagePath) && ['.jpg', '.jpeg', '.png'].includes(ext)) {
      try { doc.image(imagePath, { fit: [430, 240], align: 'center' }).moveDown(0.4); }
      catch { doc.fontSize(9).fillColor('#64748b').text('Photo file could not be embedded in the PDF.'); }
    } else doc.fontSize(9).fillColor('#64748b').text('Photo preview is unavailable in PDF; evidence metadata is recorded above.');
    if (doc.y > 690) doc.addPage();
  }

  section('Vehicle documents');
  const documents = inspection?.documents || [];
  if (!documents.length) doc.text('No documents uploaded.');
  for (const document of documents) doc.text(`${document.type}: ${document.originalName || document.filename || 'No file attached'}`);

  section('Report verification');
  const code = verifyCodeFor(job.id); const url = `${mediaBaseUrl(req)}/verify/${code}`;
  try { const qr = await QRCode.toBuffer(url, { width: 120, margin: 1 }); doc.image(qr, { width: 92 }); }
  catch { /* QR is supplementary; verification code remains available */ }
  doc.moveDown(0.3).fontSize(9).text(`Verification code: ${code} · ${url}`);
  doc.moveDown().fontSize(8).fillColor('#8a5d12').text('Provider notice: registry, market pricing, image analysis and fraud scoring are simulated in this preview; live vendor services are not connected.');
  doc.moveDown().fillColor('#61758a').text(`Generated ${new Date().toLocaleString('en-IN')} · Valuation Techno`);
  doc.end();
}));

// Phase 5 — Rating: Final = 0.4 seeker + 0.6 platform
r.post('/:id/rate', requireRole('LOAN_SEEKER', 'BANK'), wrap(async (req, res) => {
  const b = z.object({ professionalism: z.number().min(1).max(5), punctuality: z.number().min(1).max(5), communication: z.number().min(1).max(5), thoroughness: z.number().min(1).max(5), feedback: z.string().optional() }).parse(req.body);
  const job = getJob(req.params.id); if (!job?.assignedInspectorId) return res.status(409).json({ error: 'No inspector assigned' });
  if (!ensureJobAccess(job, req.user, res)) return;
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

// Bank records the separate final lending decision; this never changes valuation or triggers disbursement.
r.post('/:id/loan-decision', requireRole('BANK'), wrap(async (req, res) => {
  const b = z.object({ decision: z.enum(['APPROVED', 'DECLINED']), note: z.string().trim().max(1000).optional() }).parse(req.body);
  const job = getJob(req.params.id);
  if (!job || job.bankId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
  if (!['REPORT_DELIVERED', 'SETTLED'].includes(job.status)) return res.status(409).json({ error: 'A loan decision can be recorded only after the valuation report is delivered.' });
  const previous = getLoanDecision(job.id);
  if (previous?.decision === b.decision) return res.status(409).json({ error: `Loan decision is already recorded as ${b.decision}.` });
  if (previous && (b.note || '').trim().length < 5) return res.status(400).json({ error: 'Add a short reason when changing a previously recorded loan decision.' });
  const decidedAt = now();
  db.prepare('INSERT INTO loan_decisions VALUES(?,?,?,?,?,?)').run(uid(), job.id, req.user.id, b.decision, b.note || null, decidedAt);
  audit(job.id, req.user.id, 'LOAN_DECISION_RECORDED', `${b.decision}${previous ? ` (changed from ${previous.decision})` : ''}${b.note ? `: ${b.note}` : ''}`);
  publish({ type: 'LOAN_DECISION_RECORDED', jobId: job.id, regNumber: job.regNumber, roles: ['BANK', 'ADMIN'] });
  res.status(201).json(detail(job));
}));

// Phase 6 — Settlement (idempotent; only after report delivery)
r.post('/:id/settle', requireRole('BANK', 'ADMIN'), wrap(async (req, res) => {
  const job = getJob(req.params.id); if (!job) return res.status(404).json({ error: 'Job not found' });
  if (req.user.role === 'BANK' && job.bankId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'SETTLED') return res.status(409).json({ error: 'Already settled' });
  if (job.status !== 'REPORT_DELIVERED') return res.status(409).json({ error: `Settlement requires REPORT_DELIVERED, found ${job.status}` });
  if (config.isProduction) return res.status(503).json({ error: 'Live bank settlement is not configured. No transfer or settlement ledger entry was created.' });
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
