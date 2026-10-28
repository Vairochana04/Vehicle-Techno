import { Router } from 'express';
import { z } from 'zod';
import { db, settings, audit, publicUser } from '../db.js';
import { requireAuth, requireRole, wrap } from '../middleware/auth.js';
const r = Router(); r.use(requireAuth);
r.get('/overview', requireRole('ADMIN', 'BANK'), wrap(async (req, res) => {
  const c = (q) => db.prepare(q).get().c;
  const group = (table, column) => Object.fromEntries(db.prepare(`SELECT ${column} k, COUNT(*) n FROM ${table} GROUP BY ${column}`).all().map((r) => [r.k, r.n]));
  res.json({
    jobsTotal: c('SELECT COUNT(*) c FROM jobs'), broadcast: c("SELECT COUNT(*) c FROM jobs WHERE status='BROADCAST'"), auditRequired: c("SELECT COUNT(*) c FROM jobs WHERE status='AUDIT_REQUIRED'"), delivered: c("SELECT COUNT(*) c FROM jobs WHERE status IN ('REPORT_DELIVERED','SETTLED')"), settled: c("SELECT COUNT(*) c FROM jobs WHERE status='SETTLED'"), redFlags: c("SELECT COUNT(*) c FROM valuations WHERE flag='RED'"), greenFlags: c("SELECT COUNT(*) c FROM valuations WHERE flag='GREEN'"),
    ledgerTotal: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE type='BANK_TO_PLATFORM'").get().s,
    pendingSettlementValue: db.prepare("SELECT COALESCE(SUM(valuationFee),0) s FROM jobs WHERE status='REPORT_DELIVERED'").get().s,
    usersTotal: c('SELECT COUNT(*) c FROM users'), activeUsers: c("SELECT COUNT(*) c FROM users WHERE status='ACTIVE'"),
    jobsByStatus: group('jobs', 'status'), usersByRole: group('users', 'role'), usersByStatus: group('users', 'status'), ledgerByType: Object.fromEntries(db.prepare('SELECT type k, COALESCE(SUM(amount),0) n FROM ledger GROUP BY type').all().map((r) => [r.k, r.n])),
    averageInspectorRating: db.prepare("SELECT COALESCE(ROUND(AVG(rating),2),0) v FROM users WHERE role='INSPECTOR' AND ratingCount>0").get().v,
    allocationMode: settings.allocationMode, radiusKm: settings.radiusKm,
  });
}));
r.get('/users', requireRole('ADMIN'), wrap(async (req, res) => res.json(db.prepare('SELECT * FROM users ORDER BY role, rating DESC, name').all().map(publicUser))));
r.patch('/users/:id/status', requireRole('ADMIN'), wrap(async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'RETRAINING', 'SUSPENDED']) }).parse(req.body);
  const target = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user.id) return res.status(403).json({ error: 'You cannot change your own account status' });
  if (target.role === 'ADMIN') return res.status(403).json({ error: 'Administrator accounts are protected and cannot be suspended' });
  if (status === 'RETRAINING' && target.role !== 'INSPECTOR') return res.status(400).json({ error: 'Retraining status is only available for inspectors' });
  db.prepare('UPDATE users SET status=? WHERE id=?').run(status, target.id);
  audit(null, req.user.id, 'USER_STATUS_' + status, `${target.role}:${target.email}`);
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(target.id)) });
}));
r.get('/inspectors', requireRole('ADMIN', 'BANK'), wrap(async (req, res) => res.json(db.prepare("SELECT * FROM users WHERE role='INSPECTOR' ORDER BY rating DESC").all().map(publicUser))));
r.patch('/inspectors/:id/status', requireRole('ADMIN'), wrap(async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'RETRAINING', 'SUSPENDED']) }).parse(req.body);
  db.prepare('UPDATE users SET status=? WHERE id=?').run(status, req.params.id); audit(null, req.user.id, 'INSPECTOR_STATUS_' + status, req.params.id);
  res.json({ ok: true });
}));
r.patch('/settings', requireRole('ADMIN'), wrap(async (req, res) => {
  const b = z.object({ allocationMode: z.enum(['FIRST_COME', 'RATING_PRIORITY']).optional(), radiusKm: z.number().positive().max(200).optional() }).parse(req.body);
  if (b.allocationMode) settings.set('allocationMode', b.allocationMode); if (b.radiusKm) settings.set('radiusKm', b.radiusKm);
  audit(null, req.user.id, 'SETTINGS_UPDATED', JSON.stringify(b)); res.json({ allocationMode: settings.allocationMode, radiusKm: settings.radiusKm });
}));
const csvCell = (v) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
const sendCsv = (res, name, header, rows) => { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${name}"`); res.send([header, ...rows].join('\n')); };
r.get('/export/jobs.csv', requireRole('ADMIN', 'BANK'), wrap(async (req, res) => {
  const rows = db.prepare(`SELECT j.regNumber, j.make, j.model, j.year, j.status, j.valuationFee, j.createdAt, v.flag, v.finalValuation, i.name inspector
    FROM jobs j LEFT JOIN valuations v ON v.jobId=j.id LEFT JOIN users i ON i.id=j.assignedInspectorId ORDER BY j.createdAt DESC`).all();
  sendCsv(res, 'valuation-jobs.csv', 'Reg Number,Make,Model,Year,Status,Fee,Created,Flag,Final Valuation,Inspector',
    rows.map((x) => [x.regNumber, x.make, x.model, x.year, x.status, x.valuationFee, x.createdAt, x.flag || '', x.finalValuation || '', x.inspector || ''].map(csvCell).join(',')));
}));
r.get('/export/ledger.csv', requireRole('ADMIN', 'BANK'), wrap(async (req, res) => {
  const rows = db.prepare('SELECT * FROM ledger ORDER BY createdAt DESC').all();
  sendCsv(res, 'valuation-ledger.csv', 'Type,From,To,Amount,Status,Date',
    rows.map((x) => [x.type, x.fromParty, x.toParty, x.amount, x.status, x.createdAt].map(csvCell).join(',')));
}));
r.get('/audit-log', requireRole('ADMIN'), wrap(async (req, res) => res.json(db.prepare('SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT 200').all())));
r.get('/ledger', requireAuth, wrap(async (req, res) => {
  if (req.user.role === 'INSPECTOR') return res.json(db.prepare('SELECT * FROM ledger WHERE userId=? ORDER BY createdAt DESC').all(req.user.id));
  if (req.user.role === 'LOAN_SEEKER') return res.status(403).json({ error: 'Ledger not available for loan seekers' });
  res.json(db.prepare('SELECT * FROM ledger ORDER BY createdAt DESC LIMIT 300').all());
}));
r.get('/notifications', requireAuth, wrap(async (req, res) => res.json(db.prepare('SELECT * FROM notifications WHERE userId=? OR userId IS NULL ORDER BY createdAt DESC LIMIT 50').all(req.user.id))));
export default r;
