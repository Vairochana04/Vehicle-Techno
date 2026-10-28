import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, wrap } from '../middleware/auth.js';
import { seededInt, round2 } from '../utils.js';
import { onlineCount } from '../realtime.js';
const r = Router(); r.use(requireAuth);

// DeepSearch live market intelligence: 12-month trend + 3-month AI forecast + comparables
r.get('/market', wrap(async (req, res) => {
  const make = String(req.query.make || 'Hyundai'); const model = String(req.query.model || 'Creta');
  const base = 500000 + seededInt(`${make}|${model}`, 900000);
  const months = []; let v = base;
  for (let i = 11; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); v = Math.round(v * (1 + ((seededInt(`${make}${model}${i}`, 41) - 22) / 1000))); months.push({ month: d.toLocaleString('en-IN', { month: 'short' }), value: v }); }
  const drift = months.length > 1 ? (months.at(-1).value - months[0].value) / months[0].value / 11 : 0;
  const forecast = [1, 2, 3].map((k) => { const d = new Date(); d.setMonth(d.getMonth() + k); return { month: d.toLocaleString('en-IN', { month: 'short' }), value: Math.round(months.at(-1).value * Math.pow(1 + drift, k)) }; });
  const comparables = Array.from({ length: 6 }, (_, i) => ({ city: ['Coimbatore', 'Chennai', 'Bengaluru', 'Kochi', 'Madurai', 'Salem'][i], price: Math.round(months.at(-1).value * (0.94 + seededInt(`${model}${i}`, 13) / 100)), distanceKm: 40 + seededInt(`${model}c${i}`, 400), year: 2019 + seededInt(`${model}y${i}`, 5) }));
  res.json({ make, model, current: months.at(-1).value, trend: months, forecast, forecastChangePct: round2(drift * 300), comparables, provider: 'DeepSearch-SIM', updatedAt: new Date().toISOString() });
}));

// Platform AI analytics (Admin/Bank): portfolio risk, variance, leaderboard, volume forecast
r.get('/analytics', wrap(async (req, res) => {
  if (!['ADMIN', 'BANK'].includes(req.user.role)) return res.status(403).json({ error: 'Analytics requires Admin or Bank role' });
  const c = (q, ...a) => db.prepare(q).get(...a);
  const valuations = db.prepare('SELECT * FROM valuations').all();
  const avgVariance = valuations.length ? round2(valuations.reduce((s, v) => s + v.variancePct, 0) / valuations.length) : 0;
  const fraudRows = db.prepare('SELECT fraudJson FROM analyses').all().map((x) => JSON.parse(x.fraudJson));
  const leaderboard = db.prepare("SELECT id,name,email,rating,ratingCount,status FROM users WHERE role='INSPECTOR' ORDER BY rating DESC, ratingCount DESC").all();
  const monthly = db.prepare("SELECT substr(createdAt,1,7) m, COUNT(*) n FROM jobs GROUP BY m ORDER BY m").all();
  const jobsTotal = c('SELECT COUNT(*) c FROM jobs').c;
  res.json({
    onlineUsers: onlineCount(), jobsTotal,
    settledValue: c("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE type='BANK_TO_PLATFORM'").s,
    greenPct: valuations.length ? round2(valuations.filter((v) => v.flag === 'GREEN').length / valuations.length * 100) : 0,
    avgVariance,
    fraud: { low: fraudRows.filter((f) => f.riskLevel === 'LOW').length, medium: fraudRows.filter((f) => f.riskLevel === 'MEDIUM').length, high: fraudRows.filter((f) => f.riskLevel === 'HIGH').length, avgScore: fraudRows.length ? round2(fraudRows.reduce((s, f) => s + f.fraudScore, 0) / fraudRows.length) : 0 },
    leaderboard, monthlyVolume: monthly,
    series: (() => { const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const key = d.toISOString().slice(0, 10);
      days.push({ date: key, label: d.toLocaleString('en-IN', { day: '2-digit', month: 'short' }),
        jobs: c('SELECT COUNT(*) c FROM jobs WHERE substr(createdAt,1,10)=?', key).c,
        revenue: c("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE type='BANK_TO_PLATFORM' AND substr(createdAt,1,10)=?", key).s }); } return days; })(),
    banks: db.prepare(`SELECT u.id, COALESCE(u.bankName, u.name) bankName, COUNT(DISTINCT j.id) jobs,
      COALESCE(SUM(CASE WHEN l.type='BANK_TO_PLATFORM' THEN l.amount END),0) settledValue,
      (SELECT ROUND(AVG(f.avgScore),2) FROM bank_feedback f JOIN jobs fj ON fj.id=f.jobId WHERE fj.bankId=u.id) avgFeedback
      FROM users u LEFT JOIN jobs j ON j.bankId=u.id LEFT JOIN ledger l ON l.jobId=j.id WHERE u.role='BANK' GROUP BY u.id ORDER BY jobs DESC`).all(),
    volumeForecastNextMonth: monthly.length ? Math.max(1, Math.round(monthly.at(-1).n * 1.12)) : 1,
    insight: avgVariance > 5 ? 'Variance is trending high — consider inspector calibration / retraining for repeated RED flags.' : 'Valuation variance is healthy (≤5% band). Green-flag auto-approval is working as designed.',
  });
}));
export default r;
