import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import fs from 'node:fs';

process.env.DB_PATH = `/tmp/vt-test-${Date.now()}.db`;
process.env.JWT_SECRET = 'test-secret';
const { default: app } = await import('../src/app.js');
const { variancePct, isGreen } = await import('../src/utils.js');
const { deepSearchMarketValue, analyzeDamage, computePlatformScore, verifyVehicle } = await import('../src/services/providers.js');

const expect=(v)=>({toBe:(e)=>assert.equal(v,e),toBeCloseTo:(e,p=2)=>assert.ok(Math.abs(v-e)<10**(-p),`${v} !~ ${e}`),toContain:(e)=>assert.ok(String(v).includes(e),`${v} missing ${e}`),not:{toContain:(e)=>assert.ok(!String(v).includes(e))},toBeGreaterThanOrEqual:(e)=>assert.ok(v>=e),toBeTruthy:()=>assert.ok(v)});
const creds = { bank: ['bank@valuation.techno', 'Bank@123'], inspector: ['inspector@valuation.techno', 'Inspector@123'], inspector2: ['inspector2@valuation.techno', 'Inspector@123'], far: ['inspector3@valuation.techno', 'Inspector@123'], seeker: ['seeker@valuation.techno', 'Seeker@123'], admin: ['admin@valuation.techno', 'Admin@123'] };
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
    const up = await request(app).post('/api/upload').set(auth(T.inspector)).attach('file', Buffer.from('fake-image-bytes'), 'photo.jpg').field('category', 'FRONT');
    expect(up.status).toBe(201); expect(up.body.imageHash.length).toBe(64);
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
  it('WEBSOCKET: inspector receives JOB_CREATED instantly when bank creates a job', async () => {
    const http = await import('node:http'); const { attachRealtime } = await import('../src/realtime.js'); const { WebSocket } = await import('ws');
    const server = http.createServer(app); attachRealtime(server);
    await new Promise((r) => server.listen(0, r)); const port = server.address().port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${T.inspector}`);
    const got = new Promise((resolve, reject) => { const to = setTimeout(() => reject(new Error('WS timeout')), 5000); ws.on('message', (b) => { const m = JSON.parse(b); if (m.type === 'JOB_CREATED') { clearTimeout(to); resolve(m); } }); });
    await new Promise((r) => ws.on('open', r));
    await createJob('TN38QR9753');
    const evt = await got; expect(evt.regNumber).toBe('TN38QR9753');
    ws.close(); await new Promise((r) => server.close(r));
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
