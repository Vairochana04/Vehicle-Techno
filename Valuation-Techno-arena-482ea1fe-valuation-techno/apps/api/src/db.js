import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { uid, now } from './utils.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, phone TEXT, passwordHash TEXT NOT NULL, bankName TEXT, lat REAL, lng REAL, rating REAL NOT NULL DEFAULT 0, ratingCount INTEGER NOT NULL DEFAULT 0, ratingSum REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE', createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS otp_codes(phone TEXT PRIMARY KEY, code TEXT NOT NULL, expiresAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, bankId TEXT NOT NULL, seekerName TEXT NOT NULL, seekerPhone TEXT, seekerEmail TEXT, loanRef TEXT, regNumber TEXT NOT NULL, make TEXT NOT NULL, model TEXT NOT NULL, variant TEXT, year INTEGER NOT NULL, fuel TEXT, transmission TEXT, vehicleLat REAL, vehicleLng REAL, address TEXT, city TEXT, pincode TEXT, expectedOdometer INTEGER, valuationFee REAL NOT NULL DEFAULT 2500, status TEXT NOT NULL DEFAULT 'CREATED', verification TEXT, assignedInspectorId TEXT, allocationMode TEXT NOT NULL DEFAULT 'FIRST_COME', broadcastRadiusKm REAL NOT NULL DEFAULT 25, priorityUntil TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inspections(id TEXT PRIMARY KEY, jobId TEXT UNIQUE NOT NULL, inspectorId TEXT NOT NULL, odometerReading INTEGER, chassisNumber TEXT, conditionJson TEXT, damagesJson TEXT, manualValuation REAL, manualRepairEstimate REAL, notes TEXT, imagesJson TEXT, documentsJson TEXT, submittedAt TEXT, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS analyses(id TEXT PRIMARY KEY, jobId TEXT UNIQUE NOT NULL, damageJson TEXT NOT NULL, fraudJson TEXT NOT NULL, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS valuations(id TEXT PRIMARY KEY, jobId TEXT UNIQUE NOT NULL, marketValue REAL NOT NULL, aiValuation REAL NOT NULL, manualValuation REAL NOT NULL, variancePct REAL NOT NULL, flag TEXT NOT NULL, finalValuation REAL, status TEXT NOT NULL, varianceReasonsJson TEXT, auditJson TEXT, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, jobId TEXT UNIQUE NOT NULL, createdAt TEXT NOT NULL, deliveredAt TEXT);
CREATE TABLE IF NOT EXISTS ratings(id TEXT PRIMARY KEY, jobId TEXT UNIQUE NOT NULL, inspectorId TEXT NOT NULL, seekerJson TEXT NOT NULL, seekerScore REAL NOT NULL, platformScore REAL NOT NULL, composite REAL NOT NULL, feedback TEXT, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ledger(id TEXT PRIMARY KEY, jobId TEXT, type TEXT NOT NULL, fromParty TEXT, toParty TEXT, userId TEXT, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'PAID', ref TEXT, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, userId TEXT, title TEXT NOT NULL, body TEXT, channel TEXT NOT NULL DEFAULT 'PUSH', isRead INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_log(id TEXT PRIMARY KEY, jobId TEXT, actorId TEXT, action TEXT NOT NULL, detail TEXT, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bank_feedback(id TEXT PRIMARY KEY, jobId TEXT UNIQUE NOT NULL, bankId TEXT NOT NULL, scoresJson TEXT NOT NULL, avgScore REAL NOT NULL, comment TEXT, createdAt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loan_decisions(id TEXT PRIMARY KEY, jobId TEXT NOT NULL, bankId TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('APPROVED','DECLINED')), note TEXT, decidedAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_loan_decisions_job_time ON loan_decisions(jobId, decidedAt DESC);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, jobId TEXT NOT NULL, senderId TEXT NOT NULL, senderName TEXT, senderRole TEXT, body TEXT NOT NULL, createdAt TEXT NOT NULL);
`);
// Live inspector location columns (added without breaking existing databases)
{ const cols = db.prepare('PRAGMA table_info(jobs)').all().map((c) => c.name);
  if (!cols.includes('inspectorLat')) db.exec('ALTER TABLE jobs ADD COLUMN inspectorLat REAL');
  if (!cols.includes('inspectorLng')) db.exec('ALTER TABLE jobs ADD COLUMN inspectorLng REAL');
  if (!cols.includes('locationUpdatedAt')) db.exec('ALTER TABLE jobs ADD COLUMN locationUpdatedAt TEXT'); }
const getSetting = (k, d) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : d; };
export const settings = {
  get allocationMode() { return getSetting('allocationMode', 'FIRST_COME'); },
  get radiusKm() { return Number(getSetting('radiusKm', String(config.defaultRadiusKm))); },
  set(key, value) { db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value)); },
};
export function audit(jobId, actorId, action, detail = '') {
  db.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?)').run(uid(), jobId || null, actorId || null, action, String(detail || ''), now());
}
export function notify(userId, title, body, channel = 'PUSH') {
  db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)').run(uid(), userId || null, title, body || '', channel, 0, now());
}
export function addLedger({ jobId = null, type, fromParty, toParty, userId = null, amount, status = 'PAID', ref = '' }) {
  const existing = ref ? db.prepare('SELECT id FROM ledger WHERE type=? AND jobId IS ? AND ref=?').get(type, jobId, ref) : null;
  if (existing) return existing.id; // idempotency guard — money never double-posts
  const id = uid();
  db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, jobId, type, fromParty, toParty, userId, amount, status, ref, now());
  return id;
}
export function seed() {
  if (config.isProduction) {
    // Never create demo users/jobs in production. A real database may optionally
    // bootstrap one administrator from private hosting environment variables.
    if (db.prepare("SELECT id FROM users WHERE role='ADMIN' LIMIT 1").get()) return;
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email && !password) {
      console.warn('Production mode: demo seeding is disabled; no bootstrap administrator was configured.');
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 16) {
      throw new Error('Set a valid BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD of at least 16 characters in the hosting secret settings.');
    }
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) {
      throw new Error('BOOTSTRAP_ADMIN_EMAIL already belongs to a non-admin user. Use a different administrator email.');
    }
    const id = uid();
    db.prepare('INSERT INTO users(id,role,name,email,passwordHash,createdAt) VALUES(?,?,?,?,?,?)')
      .run(id, 'ADMIN', process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Platform Admin', email, bcrypt.hashSync(password, 12), now());
    console.info(`Production bootstrap administrator created for ${email}. Remove the bootstrap password from the host settings after confirming login.`);
    return;
  }
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c > 0) return;
  const hash = (p) => bcrypt.hashSync(p, 8); const t = now();
  const users = [
    ['ADMIN', 'Platform Admin', 'admin@valuation.techno', '+919000000001', 'Admin@123', null, 11.0168, 76.9558],
    ['BANK', 'Arun Kumar (HDFC Bank)', 'bank@valuation.techno', '+919000000002', 'Bank@123', 'HDFC Bank', 11.0168, 76.9558],
    ['BANK', 'Suresh Menon (ICICI Bank)', 'bank2@valuation.techno', '+919000000010', 'Bank@123', 'ICICI Bank', 11.0200, 76.9600],
    ['INSPECTOR', 'Inspector Ravi', 'inspector@valuation.techno', '+919000000003', 'Inspector@123', null, 11.0200, 76.9600],
    ['INSPECTOR', 'Inspector Priya', 'inspector2@valuation.techno', '+919000000004', 'Inspector@123', null, 11.0500, 76.9900],
    ['INSPECTOR', 'Inspector Karthik (Far)', 'inspector3@valuation.techno', '+919000000005', 'Inspector@123', null, 13.0827, 80.2707],
    ['INSPECTOR', 'Inspector Deepa', 'inspector4@valuation.techno', '+919000000007', 'Inspector@123', null, 11.0350, 76.9750],
    ['INSPECTOR', 'Inspector Anitha', 'inspector5@valuation.techno', '+919000000008', 'Inspector@123', null, 11.0450, 76.9350],
    ['LOAN_SEEKER', 'Demo Loan Seeker', 'seeker@valuation.techno', '+919000000006', 'Seeker@123', null, 11.0168, 76.9558],
    ['LOAN_SEEKER', 'Kavya', 'seeker2@valuation.techno', '+919000000011', 'Seeker@123', null, 11.0300, 76.9700],
    ['LOAN_SEEKER', 'Rajesh Kumar', 'seeker3@valuation.techno', '+919000000012', 'Seeker@123', null, 11.0100, 76.9400],
  ];
  const ids = {};
  for (const u of users) { const id = uid(); ids[u[2]] = id; db.prepare('INSERT INTO users(id,role,name,email,phone,passwordHash,bankName,lat,lng,createdAt) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id, u[0], u[1], u[2], u[3], hash(u[4]), u[5], u[6], u[7], t); }
  // Give Ravi a strong prior rating so RATING_PRIORITY mode is demonstrable
  db.prepare("UPDATE users SET rating=4.6, ratingCount=12, ratingSum=55.2 WHERE email='inspector@valuation.techno'").run();
  db.prepare("UPDATE users SET rating=4.1, ratingCount=8, ratingSum=32.8 WHERE email='inspector2@valuation.techno'").run();
  db.prepare("UPDATE users SET rating=4.4, ratingCount=15, ratingSum=66 WHERE email='inspector4@valuation.techno'").run();
  db.prepare("UPDATE users SET rating=3.9, ratingCount=6, ratingSum=23.4 WHERE email='inspector5@valuation.techno'").run();
  seedDemoData(ids);
}

// Rich local-preview data so every dashboard, chart and queue is testable on first login.
// This function is called only outside production mode; production keeps its own records.
function seedDemoData(ids) {
  const FEE = 2500, COMM = 500, MARGIN = 2000, PAY = 1200, BONUS = 500;
  const r2 = (n) => Math.round(n * 100) / 100;
  const ts = (d, h = 0) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString();
  const plus = (iso, hours) => new Date(Date.parse(iso) + hours * 36e5).toISOString();
  const bank1 = ids['bank@valuation.techno'], bank2 = ids['bank2@valuation.techno'], admin = ids['admin@valuation.techno'];
  const INSP = { ravi: [ids['inspector@valuation.techno'], 'Inspector Ravi'], priya: [ids['inspector2@valuation.techno'], 'Inspector Priya'], deepa: [ids['inspector4@valuation.techno'], 'Inspector Deepa'], anitha: [ids['inspector5@valuation.techno'], 'Inspector Anitha'] };
  const insJob = db.prepare('INSERT INTO jobs(id,bankId,seekerName,seekerPhone,seekerEmail,loanRef,regNumber,make,model,variant,year,fuel,transmission,vehicleLat,vehicleLng,address,city,pincode,expectedOdometer,valuationFee,status,verification,assignedInspectorId,allocationMode,broadcastRadiusKm,priorityUntil,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const insLed = db.prepare('INSERT INTO ledger VALUES(?,?,?,?,?,?,?,?,?,?)');
  const led = (jobId, type, from, to, userId, amount, ref, when) => insLed.run(uid(), jobId, type, from, to, userId, amount, 'PAID', ref, when);
  const insAudit = db.prepare('INSERT INTO audit_log VALUES(?,?,?,?,?,?)');
  const fraudLow = { fraudScore: 8, riskLevel: 'LOW', provider: 'killfake.ai-SIM', model: 'Deepfake+Metadata-SIM', checks: [
    { name: 'EXIF / Metadata Presence', status: 'PASS', detail: 'Metadata complete' },
    { name: 'Odometer Tampering', status: 'PASS', detail: 'Odometer consistent' },
    { name: 'Chassis Number Match', status: 'PASS', detail: 'Chassis matches RC' },
    { name: 'Deepfake Detection', status: 'PASS', detail: 'No manipulation detected' }] };
  const dmgOf = (total, tire) => ({ detections: [
      { part: 'Front bumper', issue: 'Scratch', confidence: 0.92, cost: Math.round(total * 0.4) },
      { part: 'Left door', issue: 'Minor dent', confidence: 0.88, cost: Math.round(total * 0.35) },
      { part: 'Rear bumper', issue: 'Paint chip', confidence: 0.85, cost: Math.round(total * 0.25) }],
    costBreakdown: { parts: Math.round(total * 0.6), labor: Math.round(total * 0.3), paint: Math.round(total * 0.1), totalDamageCost: total },
    tireWearPct: tire, model: 'XGBoost-Cost-SIM', provider: 'AI-DAMAGE-SIM' });
  const imgs = (reg, when) => ['FRONT', 'REAR', 'LEFT', 'ENGINE', 'ODOMETER'].map((c, i) => ({ category: c, lat: 11.0168, lng: 76.9558, capturedAt: when, imageHash: `seed-${reg}-${i + 1}` }));
  // [reg, make, model, variant, year, fuel, trans, customer, seekerEmail, phone, bank, inspector, kind, daysAgo, market, dmg, ai, manual, final, rating, feedback]
  const J = [
    ['TN38AB4321', 'Hyundai', 'Creta', 'SX', 2020, 'Petrol', 'Automatic', 'Vijay Menon', 'seeker@valuation.techno', '+919811111111', bank1, 'ravi', 'SETTLED', 12, 780000, 18000, 755000, 745000, 750000, [5, 4.8], 4.67],
    ['TN01CD5678', 'Maruti Suzuki', 'Swift', 'VDi', 2018, 'Diesel', 'Manual', 'Kavya', 'seeker2@valuation.techno', '+919822222222', bank2, 'priya', 'SETTLED', 10, 465000, 12000, 450000, 458000, 454000, [5, 4.5], 0],
    ['TN09EF9012', 'Toyota', 'Innova Crysta', 'GX', 2019, 'Diesel', 'Automatic', 'Senthil Kumar', 'seeker@valuation.techno', '+919833333333', bank1, 'deepa', 'DELIVERED', 8, 1560000, 26000, 1520000, 1495000, 1507500, null, 0],
    ['TN38GH3456', 'Honda', 'City', 'ZX', 2021, 'Petrol', 'Automatic', 'Rajesh Kumar', 'seeker3@valuation.techno', '+919844444444', bank2, 'ravi', 'DELIVERED', 6, 920000, 9000, 905000, 918000, 911500, null, 0],
    ['TN22IJ7890', 'Mahindra', 'XUV700', 'AX7', 2022, 'Diesel', 'Automatic', 'Kavya', 'seeker2@valuation.techno', '+919822222222', bank1, 'anitha', 'AUDIT', 4, 1420000, 42000, 1365000, 1235000, null, null, 0],
    ['TN38KL2345', 'Tata', 'Nexon', 'XM', 2021, 'Petrol', 'Manual', 'Meena', 'seeker@valuation.techno', '+919855555555', bank1, 'ravi', 'IN_PROGRESS', 2, 0, 0, 0, 0, null, null, 0],
    ['TN10MN6789', 'Kia', 'Seltos', 'HTX', 2020, 'Petrol', 'Automatic', 'Rajesh Kumar', 'seeker3@valuation.techno', '+919844444444', bank1, 'priya', 'ASSIGNED', 1, 0, 0, 0, 0, null, null, 0],
    ['TN38OP1122', 'Maruti Suzuki', 'Baleno', 'Alpha', 2019, 'Petrol', 'Manual', 'Divya', 'seeker3@valuation.techno', '+919866666666', bank1, null, 'BROADCAST', 0.2, 0, 0, 0, 0, null, null, 0],
    ['TN01QR3344', 'Hyundai', 'i20', 'Asta', 2022, 'Petrol', 'Manual', 'Kavya', 'seeker2@valuation.techno', '+919822222222', bank2, null, 'BROADCAST', 0.05, 0, 0, 0, 0, null, null, 0],
    ['TN38ST5566', 'Ford', 'EcoSport', 'Titanium', 2018, 'Diesel', 'Manual', 'Arun Prakash', 'seeker3@valuation.techno', '+919877777777', bank1, 'deepa', 'SETTLED', 13, 560000, 21000, 532000, 545000, 538500, [5, 4.6], 0],
    ['TN09UV7788', 'Tata', 'Harrier', 'XZ', 2021, 'Diesel', 'Automatic', 'Deepak', 'seeker@valuation.techno', '+919888888888', bank1, 'ravi', 'AUDITED', 9, 1380000, 30000, 1335000, 1210000, 1275000, null, 0],
    ['TN22WX9900', 'MG', 'Hector', 'Sharp', 2020, 'Petrol', 'Automatic', 'Kavya', 'seeker2@valuation.techno', '+919822222222', bank2, 'priya', 'SETTLED', 3, 890000, 15000, 868000, 852000, 860000, [4, 4.4], 4.33],
  ];
  const STATUS = { SETTLED: 'SETTLED', DELIVERED: 'REPORT_DELIVERED', AUDIT: 'AUDIT_REQUIRED', AUDITED: 'REPORT_DELIVERED', IN_PROGRESS: 'INSPECTION_IN_PROGRESS', ASSIGNED: 'ASSIGNED', BROADCAST: 'BROADCAST' };
  const PIPELINE = ['SETTLED', 'DELIVERED', 'AUDIT', 'AUDITED'];
  J.forEach((j, idx) => {
    const [reg, make, model, variant, year, fuel, trans, cust, sEmail, sPhone, bank, inspKey, kind, days, market, dmgTotal, ai, manual, final, rating, feedback] = j;
    const jobId = uid(); const created = ts(days, 2); const insp = inspKey ? INSP[inspKey] : null;
    const verification = JSON.stringify({ verified: true, provider: 'VAHAN+IIB-SIM', regNumber: reg,
      rc: { owner: cust, fuel, year }, insurance: { insurer: 'ICICI Lombard', validTill: '2027-03-31' }, ownership: { owners: 1 }, history: { accidents: 0, claims: 0 },
      checks: [{ name: 'RC Format', status: 'PASS', detail: 'Valid Indian registration format' }, { name: 'Insurance Active', status: 'PASS', detail: 'Policy active' }, { name: 'Ownership', status: 'PASS', detail: 'Single owner' }], verifiedAt: created });
    insJob.run(jobId, bank, cust, sPhone, sEmail, `LN-2026-${String(idx + 1).padStart(3, '0')}`, reg, make, model, variant, year, fuel, trans,
      11.0168 + idx * 0.004, 76.9558 + idx * 0.003, 'RS Puram', 'Coimbatore', '641002', (2026 - year) * 9500, FEE, STATUS[kind], verification,
      insp ? insp[0] : null, reg === 'TN38GH3456' ? 'RATING_PRIORITY' : 'FIRST_COME', 25, null, created, plus(created, PIPELINE.includes(kind) ? 32 : 2));
    led(jobId, 'SEEKER_FEE_TO_BANK', cust, bank === bank1 ? 'HDFC Bank' : 'ICICI Bank', bank, FEE, 'seeker-fee', plus(created, 0.1));
    insAudit.run(uid(), jobId, bank, 'JOB_CREATED', `${reg} valuation job created`, created);
    if (!PIPELINE.includes(kind)) return;
    const subAt = plus(created, 6);
    db.prepare('INSERT INTO inspections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(), jobId, insp[0], (2026 - year) * 9500 + 800, `MA3SEED${reg}`,
      JSON.stringify({ engine: 4, body: 4, tires: 3, interior: 4 }),
      JSON.stringify([{ part: 'Front bumper', type: 'Scratch', severity: 'Minor', photoCategory: 'FRONT' }, { part: 'Left door', type: 'Dent', severity: 'Minor', photoCategory: 'LEFT' }]),
      manual, Math.round(dmgTotal * 0.85), 'Vehicle in good overall condition', JSON.stringify(imgs(reg, subAt)), JSON.stringify([{ type: 'RC' }, { type: 'INSURANCE' }]), subAt, subAt);
    db.prepare('INSERT INTO analyses VALUES(?,?,?,?,?)').run(uid(), jobId, JSON.stringify(dmgOf(dmgTotal, 30 + idx * 3)), JSON.stringify(fraudLow), plus(created, 6.2));
    const variance = r2(Math.abs(manual - ai) / ai * 100);
    const flag = (kind === 'AUDIT' || kind === 'AUDITED') ? 'RED' : 'GREEN';
    const vStatus = kind === 'AUDIT' ? 'AUDIT_REQUIRED' : kind === 'AUDITED' ? 'AUDIT_APPROVED' : 'AUTO_APPROVED';
    const reasons = flag === 'GREEN' ? ['Manual and AI valuations aligned within tolerance'] : [`Manual ₹${manual} differs from AI ₹${ai} by ${variance}% (threshold 5%)`];
    const auditJson = kind === 'AUDITED' ? JSON.stringify({ by: admin, action: 'APPROVE', note: 'Verified against market comparables', at: plus(created, 30) }) : null;
    db.prepare('INSERT INTO valuations VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(uid(), jobId, market, ai, manual, variance, flag, final, vStatus, JSON.stringify(reasons), auditJson, plus(created, 6.4));
    const delivered = kind !== 'AUDIT';
    db.prepare('INSERT INTO reports VALUES(?,?,?,?)').run(uid(), jobId, plus(created, 6.5), delivered ? plus(created, 6.5) : null);
    led(jobId, 'INSPECTOR_INSTANT_PAY', 'Valuation Techno', insp[1], insp[0], PAY, 'instant-pay', plus(created, 6.1));
    insAudit.run(uid(), jobId, insp[0], 'AI_PIPELINE_RUN', `${flag} variance ${variance}% AI ₹${ai}`, plus(created, 6.5));
    if (kind === 'AUDITED') insAudit.run(uid(), jobId, admin, 'AUDIT_APPROVE', `Final ₹${final}`, plus(created, 30));
    if (kind !== 'SETTLED') return;
    const setAt = plus(created, 30);
    led(jobId, 'BANK_TO_PLATFORM', 'Bank', 'Valuation Techno', bank, FEE, 'bank-settlement', setAt);
    led(jobId, 'PLATFORM_COMMISSION', 'Valuation Techno', 'Platform', null, COMM, 'commission', setAt);
    led(jobId, 'PROVIDER_MARGIN', 'Valuation Techno', 'Service Provider', null, MARGIN, 'margin', setAt);
    insAudit.run(uid(), jobId, bank, 'PAYMENT_SETTLED', `₹${FEE} settled · commission ₹${COMM}`, setAt);
    if (rating) {
      const [ss, ps] = rating; const composite = r2(0.4 * ss + 0.6 * ps);
      db.prepare('INSERT INTO ratings VALUES(?,?,?,?,?,?,?,?,?)').run(uid(), jobId, insp[0], JSON.stringify({ professionalism: ss, punctuality: ss, behaviour: ss, comment: 'Smooth, professional inspection' }), ss, ps, composite, 'Great experience', plus(created, 32));
      if (composite >= 4.5) led(jobId, 'INSPECTOR_BONUS', 'Valuation Techno', insp[1], insp[0], BONUS, 'rating-bonus', plus(created, 32));
    }
    if (feedback) db.prepare('INSERT INTO bank_feedback VALUES(?,?,?,?,?,?,?)').run(uid(), jobId, bank, JSON.stringify({ reportQuality: 5, turnaround: 5, accuracy: 4 }), feedback, 'Report quality excellent', plus(created, 34));
  });
  // A little conversation + notifications so chat and bell icons are alive too
  const firstJob = db.prepare("SELECT id FROM jobs WHERE regNumber='TN38AB4321'").get().id;
  const fourthJob = db.prepare("SELECT id FROM jobs WHERE regNumber='TN38GH3456'").get().id;
  const insMsg = db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)');
  insMsg.run(uid(), firstJob, bank1, 'Arun Kumar (HDFC Bank)', 'BANK', 'Report received, thank you. Settling the payment today.', ts(11));
  insMsg.run(uid(), firstJob, INSP.ravi[0], 'Inspector Ravi', 'INSPECTOR', 'Thank you! The vehicle was in good condition.', ts(10.9));
  insMsg.run(uid(), fourthJob, bank2, 'Suresh Menon (ICICI Bank)', 'BANK', 'Please share the inspection photos once done.', ts(5));
  const insN = db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)');
  insN.run(uid(), bank1, 'Valuation approved: TN38AB4321', 'Variance 1.3% — GREEN flag', 'PUSH', 1, ts(11.8));
  insN.run(uid(), bank1, 'Audit approved: TN09UV7788', 'Final valuation ₹12,75,000', 'PUSH', 1, ts(8.5));
  insN.run(uid(), INSP.ravi[0], 'Instant pay received', '₹1,200 credited for TN38GH3456', 'PUSH', 0, ts(5.8));
  insN.run(uid(), admin, 'RED flag awaiting audit: TN22IJ7890', 'Variance 9.5% — review needed', 'PUSH', 0, ts(3.8));
}
export const publicUser = (u) => u && ({ id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, bankName: u.bankName, lat: u.lat, lng: u.lng, rating: u.rating, ratingCount: u.ratingCount, status: u.status });
export const parseJob = (j) => j && ({ ...j, verification: j.verification ? JSON.parse(j.verification) : null });
