import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

process.env.DB_PATH = `/tmp/vt-test-${Date.now()}.db`;
process.env.JWT_SECRET = 'test-secret';
const { default: app } = await import('../src/app.js');
const { variancePct, isGreen } = await import('../src/utils.js');
const { deepSearchMarketValue, analyzeDamage, computePlatformScore, verifyVehicle } = await import('../src/services/providers.js');
const { mediaBaseUrl } = await import('../src/routes/jobs.js');

const expect=(v)=>({toBe:(e)=>assert.equal(v,e),toBeCloseTo:(e,p=2)=>assert.ok(Math.abs(v-e)<10**(-p),`${v} !~ ${e}`),toContain:(e)=>assert.ok(String(v).includes(e),`${v} missing ${e}`),not:{toContain:(e)=>assert.ok(!String(v).includes(e))},toBeGreaterThanOrEqual:(e)=>assert.ok(v>=e),toBeTruthy:()=>assert.ok(v)});
const creds = { bank: ['bank@valuation.techno', 'Bank@123'], bank2: ['bank2@valuation.techno', 'Bank@123'], inspector: ['inspector@valuation.techno', 'Inspector@123'], inspector2: ['inspector2@valuation.techno', 'Inspector@123'], far: ['inspector3@valuation.techno', 'Inspector@123'], seeker: ['seeker@valuation.techno', 'Seeker@123'], admin: ['admin@valuation.techno', 'Admin@123'] };
const T = {};
async function login(k) { const [email, password] = creds[k]; const r = await request(app).post('/api/auth/login').send({ email, password }); expect(r.status).toBe(200); T[k] = r.body.token; return T[k]; }
before(async () => { for (const k of Object.keys(creds)) await login(k); });
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const imgs = (lat = 11.0168, lng = 76.9558, hashPrefix = 'x') => ['FRONT', 'ENGINE', 'TIRE', 'ODOMETER', 'REAR'].map((category, i) => ({ category, lat, lng, capturedAt: new Date().toISOString(), imageHash: `${hashPrefix}${i}` }));
function predictAi(jobLike, images) {
  const damage = analyzeDamage(jobLike, { images, damages: [] });
  const market = deepSearchMarketValue(jobLike);
  return Math.round((market.marketValue - damage.costBreakdown.totalDamageCost) / 500) * 500; // fraud LOW -> no penalty for clean geo/time images
}
async function createJob(reg = 'TN38AB1234', over = {}) {
  const r = await request(app).post('/api/jobs').set(auth(T.bank)).send({ seekerName: 'Demo Loan Seeker', seekerPhone: '+919000000006', seekerEmail: 'seeker@valuation.techno', loanRef: 'L1', regNumber: reg, make: 'Hyundai', model: 'Creta', year: 2020, fuel: 'Petrol', vehicleLat: 11.0168, vehicleLng: 76.9558, expectedOdometer: 45000, ...over });
  expect(r.status).toBe(201); return r.body;
}

describe('production safety guards', () => {
  it('does not seed demo accounts or jobs in production', () => {
    const dbPath = `/tmp/vt-prod-seed-${process.pid}-${Date.now()}.db`;
    const dbModule = new URL('../src/db.js', import.meta.url).href;
    const script = `import { seed, db } from ${JSON.stringify(dbModule)}; seed(); const users = db.prepare('SELECT COUNT(*) c FROM users').get().c; const jobs = db.prepare('SELECT COUNT(*) c FROM jobs').get().c; db.close(); if (users || jobs) process.exit(2);`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(64), DB_PATH: dbPath, CORS_ORIGIN: 'https://portal.example.test', BOOTSTRAP_ADMIN_EMAIL: '', BOOTSTRAP_ADMIN_PASSWORD: '' },
    });
    try {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stderr, /demo seeding is disabled/);
    } finally {
      for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${dbPath}${suffix}`, { force: true });
    }
  });
  it('refuses simulated provider results in production', () => {
    const providersModule = new URL('../src/services/providers.js', import.meta.url).href;
    const script = `import * as p from ${JSON.stringify(providersModule)}; const calls = [() => p.verifyVehicle({ regNumber: 'TN38AB1234' }), () => p.deepSearchMarketValue({ make: 'Hyundai', model: 'Creta', year: 2020 }), () => p.analyzeDamage({}, { images: [], damages: [] }), () => p.analyzeFraud({}, { images: [] })]; for (const call of calls) { try { call(); process.exit(2); } catch (error) { if (error.status !== 503 || !error.message.includes('not simulated')) process.exit(3); } }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'p'.repeat(64), DB_PATH: '/tmp/vt-prod-provider-test.db', CORS_ORIGIN: 'https://portal.example.test' },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
});

describe('report and QR public URL handling', () => {
  it('uses the public forwarded origin for scanner links behind a preview proxy', () => {
    const headers = { 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'valuation.example.test, internal:4000', host: 'internal:4000' };
    const req = { protocol: 'http', get: (name) => headers[name] };
    expect(mediaBaseUrl(req)).toBe('https://valuation.example.test');
  });
});
describe('unit: variance & rating math (case-study rules)', () => {
  it('variance 5% boundary: <=5 green, >5 red', () => { expect(variancePct(105, 100)).toBe(5); expect(isGreen(5)).toBe(true); expect(isGreen(5.01)).toBe(false); expect(variancePct(700000, 738500)).toBe(5.21); });
  it('vehicle verification rejects bad plate, passes Indian plate', () => { expect(verifyVehicle({ regNumber: '1234' }).verified).toBe(false); expect(verifyVehicle({ regNumber: 'TN38AB1234' }).verified).toBe(true); });
  it('platform score penalizes variance', () => { expect(computePlatformScore({ variance: 0, fraudScore: 0, imagesCount: 5, docsCount: 3 })).toBe(5); expect(computePlatformScore({ variance: 50, fraudScore: 0, imagesCount: 5, docsCount: 3 })).toBe(3); });
});
describe('auth', () => {
  it('rejects wrong password & unauthenticated access', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: creds.bank[0], password: 'wrong-pass' })).status).toBe(401);
    expect((await request(app).get('/api/jobs')).status).toBe(401);
  });
  it('OTP demo flow issues and verifies', async () => {
    const r = await request(app).post('/api/auth/otp/request').send({ phone: '+919000000003' }); expect(r.status).toBe(200);
    const v = await request(app).post('/api/auth/otp/verify').send({ phone: '+919000000003', code: r.body.demoOtp }); expect(v.status).toBe(200); expect(v.body.token).toBeTruthy();
    expect((await request(app).post('/api/auth/otp/verify').send({ phone: '+919000000003', code: '000000' })).status).toBe(401);
  });
  it('inspector cannot create jobs (role guard)', async () => { expect((await request(app).post('/api/jobs').set(auth(T.inspector)).send({})).status).toBe(403); });
});
describe('bank ledger visibility', () => {
  it('limits a bank ledger response to jobs owned by that bank', async () => {
    const jobs = await request(app).get('/api/jobs').set(auth(T.bank2));
    const ledger = await request(app).get('/api/admin/ledger').set(auth(T.bank2));
    expect(jobs.status).toBe(200); expect(ledger.status).toBe(200);
    const ownedJobIds = new Set(jobs.body.map((job) => job.id));
    assert.ok(ledger.body.length > 0);
    assert.ok(ledger.body.every((entry) => ownedJobIds.has(entry.jobId)), 'bank ledger must not include another bank’s job entries');
  });
});
describe('Phase 1: job, verification, broadcast, exclusive accept', () => {
  it('invalid registration is rejected with verification detail', async () => {
    const r = await request(app).post('/api/jobs').set(auth(T.bank)).send({ seekerName: 'X Y', regNumber: 'BAD123', make: 'Hyundai', model: 'Creta', year: 2020, vehicleLat: 11, vehicleLng: 76 });
    expect(r.status).toBe(422); expect(r.body.verification.verified).toBe(false);
  });
  it('far inspector (Chennai) cannot accept Coimbatore job; second accept is 409', async () => {
    const job = await createJob('TN37CD5678');
    expect(job.status).toBe('BROADCAST'); expect(job.verification.rc.status).toBe('ACTIVE');
    expect((await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.far))).status).toBe(403);
    expect((await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector))).status).toBe(200);
    expect((await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector2))).status).toBe(409);
  });
});
describe('Phases 2-6: GREEN path end-to-end', () => {
  it('inspection -> AI -> green auto-approve -> report -> rating 0.4/0.6 -> settle (no double settle)', async () => {
    const job = await createJob('TN38EF9012');
    const images = imgs(); const ai = predictAi(job, images);
    await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector));
    await request(app).post(`/api/jobs/${job.id}/start`).set(auth(T.inspector));
    const sub = await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector)).send({ odometerReading: 45200, condition: { engine: 4 }, damages: [], manualValuation: ai, manualRepairEstimate: 0, images, documents: [{ type: 'RC' }, { type: 'INSURANCE' }, { type: 'POLLUTION' }] });
    expect(sub.status).toBe(201); expect(sub.body.status).toBe('REPORT_DELIVERED'); expect(sub.body.valuation.flag).toBe('GREEN'); expect(sub.body.valuation.variancePct).toBe(0);
    expect(sub.body.ledger.filter((l) => l.type === 'INSPECTOR_INSTANT_PAY').length).toBe(1);
    // duplicate submit blocked, instant pay stays exactly once
    expect((await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector)).send({ odometerReading: 1, manualValuation: 1, images })).status).toBe(409);
    const report = await request(app).get(`/api/jobs/${job.id}/report`).set(auth(T.bank)); expect(report.status).toBe(200); expect(report.text).toContain('GREEN FLAG');
    const seekerReport = await request(app).get(`/api/jobs/${job.id}/report`).set(auth(T.seeker)); expect(seekerReport.text).not.toContain('AI Valuation'); // summary privacy
    const rated = await request(app).post(`/api/jobs/${job.id}/rate`).set(auth(T.seeker)).send({ professionalism: 5, punctuality: 5, communication: 5, thoroughness: 5 });
    expect(rated.status).toBe(201); expect(rated.body.seekerScore).toBe(5); expect(rated.body.composite).toBeCloseTo(0.4 * 5 + 0.6 * rated.body.platformScore, 2);
    expect((await request(app).post(`/api/jobs/${job.id}/rate`).set(auth(T.seeker)).send({ professionalism: 5, punctuality: 5, communication: 5, thoroughness: 5 })).status).toBe(409);
    const settled = await request(app).post(`/api/jobs/${job.id}/settle`).set(auth(T.bank)); expect(settled.body.status).toBe('SETTLED');
    expect(settled.body.ledger.filter((l) => l.type === 'PLATFORM_COMMISSION')[0].amount).toBe(500); // 20% of 2500
    expect((await request(app).post(`/api/jobs/${job.id}/settle`).set(auth(T.bank))).status).toBe(409);
    const settledReport = await request(app).get(`/api/jobs/${job.id}/report`).set(auth(T.seeker));
    expect(settledReport.status).toBe(200); expect(settledReport.headers['content-type']).toContain('text/html'); expect(settledReport.text).toContain('Vehicle Valuation Summary');
    const settledQr = await request(app).get(`/api/jobs/${job.id}/qr`).set(auth(T.seeker));
    expect(settledQr.status).toBe(200); expect(settledQr.headers['content-type']).toContain('image/png');
    const seekerDetail = await request(app).get(`/api/jobs/${job.id}`).set(auth(T.seeker));
    expect(settledReport.text).toContain('Scan to verify report'); expect(settledReport.text).toContain(seekerDetail.body.verifyCode); expect(settledReport.text).toContain('data:image/png;base64,'); expect(settledReport.text).toContain('VALUATION APPROVED'); expect(settledReport.text).toContain('The bank makes the final loan decision separately.'); expect(settledReport.text).not.toContain('class="summary-photo"');
    const settledPdf = await request(app).get(`/api/jobs/${job.id}/report.pdf`).set(auth(T.seeker));
    expect(settledPdf.status).toBe(200); expect(settledPdf.headers['content-type']).toContain('application/pdf');
    const publicVerify = await request(app).get(`/api/verify/${seekerDetail.body.verifyCode}`);
    expect(publicVerify.status).toBe(200); expect(publicVerify.body.authentic).toBe(true); expect(publicVerify.body.status).toBe('SETTLED');
  });
});
describe('Bank final loan decision', () => {
  it('records an owning bank decision after report delivery and preserves change history', async () => {
    const job = await createJob('TN38DE2468');
    const damages = [{ part: 'Front bumper', type: 'scratch', severity: 'Small', description: 'Paint scratch near the left edge', repairEstimate: 3500 }];
    const images = [...imgs(11.0168, 76.9558, 'loan'), { category: 'DAMAGE', lat: 11.0168, lng: 76.9558, capturedAt: new Date().toISOString(), imageHash: 'loan-damage-photo' }];
    const market = deepSearchMarketValue(job).marketValue;
    const damageTotal = analyzeDamage(job, { images, damages }).costBreakdown.totalDamageCost;
    const ai = Math.round((market - damageTotal) / 500) * 500;
    await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector));
    const submitted = await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector)).send({ odometerReading: 45200, condition: { engine: 5, body: 4, tires: 4, interior: 3 }, damages, manualRepairEstimate: 3500, manualValuation: ai, images, documents: [{ type: 'RC' }] });
    expect(submitted.status).toBe(201); expect(submitted.body.status).toBe('REPORT_DELIVERED'); expect(submitted.body.inspection.condition.engine).toBe(5); expect(submitted.body.inspection.damages[0].repairEstimate).toBe(3500);
    const fullReport = await request(app).get(`/api/jobs/${job.id}/report`).set(auth(T.bank)); expect(fullReport.status).toBe(200); expect(fullReport.text).toContain('Paint scratch near the left edge'); expect(fullReport.text).toContain('Inspector condition ratings');
    expect((await request(app).post(`/api/jobs/${job.id}/loan-decision`).set(auth(T.inspector)).send({ decision: 'APPROVED' })).status).toBe(403);
    expect((await request(app).post(`/api/jobs/${job.id}/loan-decision`).set(auth(T.bank2)).send({ decision: 'APPROVED' })).status).toBe(404);
    const approved = await request(app).post(`/api/jobs/${job.id}/loan-decision`).set(auth(T.bank)).send({ decision: 'APPROVED', note: 'Reviewed valuation report' });
    expect(approved.status).toBe(201); expect(approved.body.loanDecision.decision).toBe('APPROVED');
    expect((await request(app).post(`/api/jobs/${job.id}/loan-decision`).set(auth(T.bank)).send({ decision: 'APPROVED' })).status).toBe(409);
    expect((await request(app).post(`/api/jobs/${job.id}/loan-decision`).set(auth(T.bank)).send({ decision: 'DECLINED' })).status).toBe(400);
    const changed = await request(app).post(`/api/jobs/${job.id}/loan-decision`).set(auth(T.bank)).send({ decision: 'DECLINED', note: 'Updated after final credit review' });
    expect(changed.status).toBe(201); expect(changed.body.loanDecision.decision).toBe('DECLINED'); expect(changed.body.loanDecisionHistory.length).toBe(2);
    const bankView = await request(app).get(`/api/jobs/${job.id}`).set(auth(T.bank));
    expect(bankView.body.loanDecisionHistory.length).toBe(2);
    const inspectorView = await request(app).get(`/api/jobs/${job.id}`).set(auth(T.inspector));
    expect(Object.hasOwn(inspectorView.body, 'loanDecision')).toBe(false);
    const seekerView = await request(app).get(`/api/jobs/${job.id}`).set(auth(T.seeker));
    expect(Object.hasOwn(seekerView.body, 'loanDecision')).toBe(false);
  });
});

describe('Phase 3/4: fraud + RED path with audit', () => {
  it('duplicate images + GPS mismatch raise fraud; red flag needs admin audit before settle', async () => {
    const job = await createJob('TN38GH3456');
    const fraudImages = imgs(12.5, 77.5).map((i) => ({ ...i, imageHash: 'SAMEHASH' }));
    await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector2));
    const sub = await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector2)).send({ odometerReading: 1000, damages: [], manualValuation: 100000, images: fraudImages, documents: [{ type: 'RC' }] });
    expect(sub.status).toBe(201); expect(sub.body.status).toBe('AUDIT_REQUIRED'); expect(sub.body.valuation.flag).toBe('RED'); expect(sub.body.analysis.fraud.fraudScore).toBeGreaterThanOrEqual(55);
    expect((await request(app).post(`/api/jobs/${job.id}/settle`).set(auth(T.bank))).status).toBe(409);
    const audited = await request(app).post(`/api/jobs/${job.id}/audit`).set(auth(T.admin)).send({ action: 'APPROVE', finalValuation: 500000, note: 'Senior reviewed' });
    expect(audited.status).toBe(200); expect(audited.body.status).toBe('REPORT_DELIVERED'); expect(audited.body.valuation.finalValuation).toBe(500000);
  });
  it('rating-priority mode blocks lower-rated inspector during priority window', async () => {
    await request(app).patch('/api/admin/settings').set(auth(T.admin)).send({ allocationMode: 'RATING_PRIORITY' });
    const job = await createJob('TN38JK7890');
    expect(job.allocationMode).toBe('RATING_PRIORITY');
    // inspector2 (4.1) is blocked while Ravi (4.6) holds priority; Ravi can accept
    expect((await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector2))).status).toBe(403);
    expect((await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector))).status).toBe(200);
    await request(app).patch('/api/admin/settings').set(auth(T.admin)).send({ allocationMode: 'FIRST_COME' });
  });
});

describe('Step 9 hardening: bank feedback, re-inspection, PDF, upload, suspension', () => {
  it('bank feedback stores once, rejects duplicates and other banks flows', async () => {
    const job = await createJob('TN38LM2468');
    const images = imgs('11.0168' * 1, 76.9558, 'bf');
    const ai = predictAi(job, images);
    await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector));
    await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector)).send({ odometerReading: 45200, damages: [], manualValuation: ai, images, documents: [{ type: 'RC' }, { type: 'INSURANCE' }, { type: 'POLLUTION' }] });
    expect((await request(app).post(`/api/jobs/${job.id}/bank-feedback`).set(auth(T.seeker)).send({ reportQuality: 5, timeliness: 5, accuracy: 5 })).status).toBe(403);
    const fb = await request(app).post(`/api/jobs/${job.id}/bank-feedback`).set(auth(T.bank)).send({ reportQuality: 5, timeliness: 4, accuracy: 5, comment: 'Clear report' });
    expect(fb.status).toBe(201); expect(fb.body.avgScore).toBe(4.67);
    expect((await request(app).post(`/api/jobs/${job.id}/bank-feedback`).set(auth(T.bank)).send({ reportQuality: 5, timeliness: 5, accuracy: 5 })).status).toBe(409);
    const detail = await request(app).get(`/api/jobs/${job.id}`).set(auth(T.bank));
    expect(detail.body.bankFeedback.avgScore).toBe(4.67);
  });
  it('re-inspection cycle: RED -> re-inspection -> fresh inspection completes', async () => {
    const job = await createJob('TN38NP1357');
    await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector2));
    const sub = await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector2)).send({ odometerReading: 45200, damages: [], manualValuation: 100000, images: imgs(11.0168, 76.9558, 're'), documents: [{ type: 'RC' }] });
    expect(sub.body.status).toBe('AUDIT_REQUIRED');
    const re = await request(app).post(`/api/jobs/${job.id}/audit`).set(auth(T.admin)).send({ action: 'RE_INSPECTION', note: 'Photos unclear' });
    expect(re.status).toBe(200); expect(re.body.status).toBe('BROADCAST'); expect(re.body.assignedInspector).toBe(null);
    await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector2));
    const images = imgs(11.0168, 76.9558, 're2'); const ai = predictAi(re.body, images);
    const sub2 = await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector2)).send({ odometerReading: 45200, damages: [], manualValuation: ai, images, documents: [{ type: 'RC' }, { type: 'INSURANCE' }, { type: 'POLLUTION' }] });
    expect(sub2.status).toBe(201); expect(sub2.body.status).toBe('REPORT_DELIVERED');
    // Two instant pays (one per inspection cycle), each exactly once per cycle
    expect(sub2.body.ledger.filter((l) => l.type === 'INSPECTOR_INSTANT_PAY' && l.amount === 1200).length).toBe(2);
  });
  it('PDF report downloads and file upload returns a fraud-check hash', async () => {
    const jobs = await request(app).get('/api/jobs').set(auth(T.bank));
    const done = jobs.body.find((j) => j.valuation?.finalValuation);
    const pdf = await request(app).get(`/api/jobs/${done.id}/report.pdf`).set(auth(T.bank));
    expect(pdf.status).toBe(200); expect(pdf.headers['content-type']).toContain('application/pdf');
    const capturedAt = new Date().toISOString();
    const up = await request(app).post('/api/upload').set(auth(T.inspector)).attach('file', Buffer.from('fake-image-bytes'), 'photo.jpg').field('category', 'FRONT').field('lat', '11.0168').field('lng', '76.9558').field('capturedAt', capturedAt);
    expect(up.status).toBe(201); expect(up.body.imageHash.length).toBe(64); expect(up.body.url).toBe(undefined); expect(up.body.lat).toBe(11.0168); expect(up.body.lng).toBe(76.9558); expect(up.body.capturedAt).toBe(capturedAt);
    const partialGps = await request(app).post('/api/upload').set(auth(T.inspector)).attach('file', Buffer.from('bad-gps-image'), 'gps.jpg').field('lat', '11.0168');
    expect(partialGps.status).toBe(400);
  });
  it('stores uploaded vehicle documents with the inspection and protects their download', async () => {
    const job = await createJob('TN38DS7412'); const images = imgs(11.0168, 76.9558, 'doc'); const ai = predictAi(job, images);
    await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector));
    const file = await request(app).post('/api/upload').set(auth(T.inspector)).attach('file', Buffer.from('%PDF-1.4 test RC document'), 'rc-document.pdf').field('category', 'RC');
    expect(file.status).toBe(201);
    const sub = await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector)).send({ odometerReading: 45200, damages: [], manualValuation: ai, images, documents: [{ type: 'RC', filename: file.body.filename, originalName: file.body.originalName }] });
    expect(sub.status).toBe(201); expect(sub.body.inspection.documents[0].originalName).toBe('rc-document.pdf');
    const bankFile = await request(app).get(`/api/jobs/${job.id}/files/${file.body.filename}`).set(auth(T.bank));
    expect(bankFile.status).toBe(200); expect(bankFile.headers['content-type']).toContain('application/pdf');
    const seekerFile = await request(app).get(`/api/jobs/${job.id}/files/${file.body.filename}`).set(auth(T.seeker));
    expect(seekerFile.status).toBe(404);
    const report = await request(app).get(`/api/jobs/${job.id}/report`).set(auth(T.bank));
    expect(report.status).toBe(200); expect(report.text).toContain('RC'); expect(report.text).toContain(`/api/jobs/${job.id}/files/${file.body.filename}`); expect(report.text).not.toContain('/uploads/');
  });
  it('suspended inspector cannot login or accept; admin can reactivate', async () => {
    const list = await request(app).get('/api/admin/inspectors').set(auth(T.admin));
    const far = list.body.find((u) => u.email === 'inspector3@valuation.techno');
    await request(app).patch(`/api/admin/inspectors/${far.id}/status`).set(auth(T.admin)).send({ status: 'SUSPENDED' });
    expect((await request(app).post('/api/auth/login').send({ email: 'inspector3@valuation.techno', password: 'Inspector@123' })).status).toBe(403);
    await request(app).patch(`/api/admin/inspectors/${far.id}/status`).set(auth(T.admin)).send({ status: 'ACTIVE' });
    expect((await request(app).post('/api/auth/login').send({ email: 'inspector3@valuation.techno', password: 'Inspector@123' })).status).toBe(200);
  });
});

describe('Real-time layer + AI analytics (production upgrade)', () => {
  it('market intelligence returns trend, forecast and comparables', async () => {
    const m = await request(app).get('/api/market?make=Hyundai&model=Creta').set(auth(T.bank));
    expect(m.status).toBe(200); expect(m.body.trend.length).toBe(12); expect(m.body.forecast.length).toBe(3); expect(m.body.comparables.length).toBe(6);
  });
  it('analytics is role-guarded and returns leaderboard + fraud distribution', async () => {
    expect((await request(app).get('/api/analytics').set(auth(T.seeker))).status).toBe(403);
    const a = await request(app).get('/api/analytics').set(auth(T.admin));
    expect(a.status).toBe(200); expect(a.body.leaderboard.length >= 3 ? true : false).toBe(true); expect(typeof a.body.avgVariance).toBe('number');
  });
  it('WEBSOCKET: bank and inspector receive live job-progress events', async () => {
    const http = await import('node:http'); const { attachRealtime } = await import('../src/realtime.js'); const { WebSocket } = await import('ws');
    const server = http.createServer(app); attachRealtime(server);
    await new Promise((r) => server.listen(0, r)); const port = server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${T.inspector}`);
    const bankWs = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${T.bank}`);
    const waitFor = (socket, type) => new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error(`WS timeout waiting for ${type}`)), 5000); socket.on('message', (b) => { const m = JSON.parse(b); if (m.type === type) { clearTimeout(to); resolve(m); } }); });
    const created = waitFor(ws, 'JOB_CREATED');
    const started = waitFor(bankWs, 'INSPECTION_STARTED');
    await Promise.all([new Promise((r) => ws.on('open', r)), new Promise((r) => bankWs.on('open', r))]);
    const job = await createJob('TN38QR9753');
    const createdEvent = await created; expect(createdEvent.regNumber).toBe('TN38QR9753');
    expect((await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector))).status).toBe(200);
    expect((await request(app).post(`/api/jobs/${job.id}/start`).set(auth(T.inspector))).status).toBe(200);
    const startedEvent = await started; expect(startedEvent.regNumber).toBe('TN38QR9753');
    ws.close(); bankWs.close();
    await Promise.all([new Promise((r) => ws.once('close', r)), new Promise((r) => bankWs.once('close', r))]);
    await new Promise((r) => server.close(r));
  });
});

describe('Session transport fix (preview proxy strips Authorization)', () => {
  it('accepts X-Auth-Token header and vt_token cookie, not just Bearer', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@valuation.techno', password: 'Admin@123' });
    expect(login.status).toBe(200);
    const tok = login.body.token;
    expect((login.headers['set-cookie'] || []).join(' ').includes('vt_token=')).toBe(true);
    expect((await request(app).get('/api/jobs').set('X-Auth-Token', tok)).status).toBe(200);
    expect((await request(app).get('/api/jobs').set('Cookie', `vt_token=${tok}`)).status).toBe(200);
    const expired = await request(app).get('/api/jobs');
    expect(expired.status).toBe(401);
  });
});

describe('Admin Control Centre management APIs', () => {
  it('admin can list every platform user; other roles cannot', async () => {
    expect((await request(app).get('/api/admin/users').set(auth(T.bank))).status).toBe(403);
    expect((await request(app).get('/api/admin/users').set(auth(T.inspector))).status).toBe(403);
    const users = await request(app).get('/api/admin/users').set(auth(T.admin));
    expect(users.status).toBe(200);
    expect(new Set(users.body.map((u) => u.role)).size >= 4 ? true : false).toBe(true);
    expect(users.body.some((u) => u.role === 'BANK')).toBe(true);
    expect(users.body.some((u) => u.role === 'LOAN_SEEKER')).toBe(true);
  });
  it('overview exposes dashboard distributions for circular charts', async () => {
    const o = await request(app).get('/api/admin/overview').set(auth(T.admin));
    expect(o.status).toBe(200); expect(typeof o.body.jobsByStatus).toBe('object'); expect(typeof o.body.usersByRole).toBe('object'); expect(o.body.usersTotal >= 6 ? true : false).toBe(true);
  });
  it('admin status controls work, while admin accounts and self-changes are protected', async () => {
    const users = await request(app).get('/api/admin/users').set(auth(T.admin));
    const seeker = users.body.find((u) => u.role === 'LOAN_SEEKER'); const me = users.body.find((u) => u.email === 'admin@valuation.techno');
    expect((await request(app).patch(`/api/admin/users/${seeker.id}/status`).set(auth(T.bank)).send({ status: 'SUSPENDED' })).status).toBe(403);
    expect((await request(app).patch(`/api/admin/users/${me.id}/status`).set(auth(T.admin)).send({ status: 'SUSPENDED' })).status).toBe(403);
    expect((await request(app).patch(`/api/admin/users/${seeker.id}/status`).set(auth(T.admin)).send({ status: 'RETRAINING' })).status).toBe(400);
    const changed = await request(app).patch(`/api/admin/users/${seeker.id}/status`).set(auth(T.admin)).send({ status: 'SUSPENDED' });
    expect(changed.status).toBe(200); expect(changed.body.user.status).toBe('SUSPENDED');
    await request(app).patch(`/api/admin/users/${seeker.id}/status`).set(auth(T.admin)).send({ status: 'ACTIVE' });
  });
});

describe('All-updates pack: QR verify, chat, live GPS, CSV, analytics series', () => {
  it('QR verification: genuine report verifies publicly, fake code rejected', async () => {
    const job = await createJob('TN38QR1111');
    const images = imgs(11.0168, 76.9558, 'qr'); const ai = predictAi(job, images);
    await request(app).post(`/api/jobs/${job.id}/accept`).set(auth(T.inspector));
    await request(app).post(`/api/jobs/${job.id}/start`).set(auth(T.inspector));
    const sub = await request(app).post(`/api/jobs/${job.id}/inspection`).set(auth(T.inspector)).send({ odometerReading: 45200, damages: [], manualValuation: ai, images, documents: [{ type: 'RC' }] });
    expect(sub.status).toBe(201); expect(sub.body.status).toBe('REPORT_DELIVERED');
    const detail = await request(app).get(`/api/jobs/${job.id}`).set(auth(T.bank));
    expect(detail.body.verifyCode).toBeTruthy();
    const pub = await request(app).get(`/api/verify/${detail.body.verifyCode}`); // no login needed
    expect(pub.status).toBe(200); expect(pub.body.authentic).toBe(true); expect(pub.body.regNumber).toBe('TN38QR1111');
    expect((await request(app).get('/api/verify/VT-FAKECODE0')).status).toBe(404);
    const report = await request(app).get(`/api/jobs/${job.id}/report`).set(auth(T.bank));
    expect(report.text).toContain('Verify This Report'); expect(report.text).toContain(detail.body.verifyCode);
    // chat: bank + assigned inspector can talk; seeker is blocked
    expect((await request(app).post(`/api/jobs/${job.id}/messages`).set(auth(T.bank)).send({ body: 'Please reach by 11 AM' })).status).toBe(201);
    const msgs = await request(app).get(`/api/jobs/${job.id}/messages`).set(auth(T.inspector));
    expect(msgs.status).toBe(200); expect(msgs.body.length >= 1 ? true : false).toBe(true); expect(msgs.body[0].body).toContain('11 AM');
    expect((await request(app).get(`/api/jobs/${job.id}/messages`).set(auth(T.seeker))).status).toBe(403);
    // live GPS: only the assigned inspector may share
    expect((await request(app).post(`/api/jobs/${job.id}/location`).set(auth(T.bank)).send({ lat: 11.02, lng: 76.96 })).status).toBe(403);
    expect((await request(app).post(`/api/jobs/${job.id}/location`).set(auth(T.inspector)).send({ lat: 11.02, lng: 76.96 })).status).toBe(200);
    const after = await request(app).get(`/api/jobs/${job.id}`).set(auth(T.bank));
    expect(after.body.inspectorLocation.lat).toBe(11.02);
  });
  it('CSV exports download for admin/bank, blocked for seeker', async () => {
    const jobsCsv = await request(app).get('/api/admin/export/jobs.csv').set(auth(T.admin));
    expect(jobsCsv.status).toBe(200); expect(jobsCsv.headers['content-type']).toContain('text/csv'); expect(jobsCsv.text).toContain('Reg Number');
    const ledgerCsv = await request(app).get('/api/admin/export/ledger.csv').set(auth(T.bank));
    expect(ledgerCsv.status).toBe(200); expect(ledgerCsv.text).toContain('Type,From,To,Amount');
    expect((await request(app).get('/api/admin/export/jobs.csv').set(auth(T.seeker))).status).toBe(403);
  });
  it('analytics returns 14-day series and bank-wise performance', async () => {
    const a = await request(app).get('/api/analytics').set(auth(T.admin));
    expect(a.status).toBe(200); expect(a.body.series.length).toBe(14); expect(a.body.banks.length >= 1 ? true : false).toBe(true);
    expect(typeof a.body.banks[0].jobs).toBe('number');
  });
});

describe('QR code image (in-app + reports)', () => {
  it('serves a PNG QR image for a delivered report, 409 before the report exists', async () => {
    const jobs = await request(app).get('/api/jobs').set(auth(T.bank));
    const done = jobs.body.find((j) => j.valuation?.finalValuation);
    expect(done).toBeTruthy();
    const det = await request(app).get(`/api/jobs/${done.id}`).set(auth(T.bank));
    expect(det.body.verifyCode).toBeTruthy();
    const qr = await request(app).get(`/api/jobs/${done.id}/qr`).set(auth(T.bank));
    expect(qr.status).toBe(200); expect(qr.headers['content-type']).toContain('image/png');
    const fresh = await createJob('TN38QR2222');
    expect((await request(app).get(`/api/jobs/${fresh.id}/qr`).set(auth(T.bank))).status).toBe(409);
  });
});
