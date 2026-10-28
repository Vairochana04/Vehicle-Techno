import { seededInt, round2, clamp, haversineKm } from '../utils.js';

/* Provider interfaces — deterministic simulators behind real contracts.
   Swap each function with live vendor calls (VAHAN/IIB/DeepSearch/killfake/Razorpay)
   or the Python FastAPI ML service without changing routes/UI. See docs/TECH_STACK_DECISION.md */

const REG_RE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/;
export function verifyVehicle({ regNumber, expectedOdometer }) {
  const reg = String(regNumber || '').toUpperCase().replace(/\s/g, '');
  if (!REG_RE.test(reg)) return { verified: false, provider: 'VAHAN-SIM', regNumber: reg, checks: [{ name: 'RC Format', status: 'FAIL', detail: 'Invalid Indian registration format (e.g. TN38AB1234)' }], rc: null, insurance: null, ownership: null, history: null };
  const h = seededInt(reg, 1000);
  const insuranceExpired = h % 7 === 0;
  const claims = h % 4; const accidents = claims === 0 ? 0 : (h % 3);
  const owners = 1 + (h % 3);
  const rc = { status: 'ACTIVE', regNumber: reg, chassisNumber: `CHS${reg}${1000 + (h % 9000)}`, engineNumber: `ENG${50000 + h}`, registrationDate: `${2018 + (h % 6)}-0${1 + (h % 9)}-15`, fitnessUpto: '2033-12-31' };
  const insurance = { provider: 'IIB-SIM', policyNumber: `POL${800000 + h}`, valid: !insuranceExpired, expiry: insuranceExpired ? '2024-01-31' : '2027-06-30' };
  const ownership = { currentOwner: 'As per VAHAN record', ownersCount: owners, hypothecation: h % 5 === 0 ? 'HDFC Bank' : null, verified: true };
  const history = { accidentCount: accidents, claimCount: claims, claimAmount: claims * 18500, theftHistory: false, floodHistory: h % 13 === 0 };
  const checks = [
    { name: 'RC Verification (VAHAN)', status: 'PASS', detail: `RC ACTIVE, chassis ${rc.chassisNumber}` },
    { name: 'Insurance (IIB)', status: insuranceExpired ? 'WARN' : 'PASS', detail: insuranceExpired ? 'Policy expired — renewal required' : `Valid till ${insurance.expiry}` },
    { name: 'Ownership', status: 'PASS', detail: `${owners} owner(s)${ownership.hypothecation ? ', hypothecated to ' + ownership.hypothecation : ''}` },
    { name: 'Accident & Claim History', status: claims >= 3 ? 'WARN' : 'PASS', detail: `${accidents} accident(s), ${claims} claim(s) ₹${history.claimAmount}` },
  ];
  return { verified: true, provider: 'VAHAN+IIB-SIM', regNumber: reg, rc, insurance, ownership, history, checks, verifiedAt: new Date().toISOString() };
}

const CATALOG = { 'maruti suzuki|swift': 899000, 'maruti suzuki|baleno': 935000, 'hyundai|creta': 1738000, 'hyundai|i20': 1050000, 'tata|nexon': 1460000, 'tata|punch': 1010000, 'mahindra|xuv700': 2645000, 'mahindra|scorpio-n': 2414000, 'toyota|innova crysta': 2663000, 'honda|city': 1592000, 'kia|seltos': 1885000 };
export function deepSearchMarketValue(job) {
  const key = `${String(job.make).toLowerCase().trim()}|${String(job.model).toLowerCase().trim()}`;
  const newPrice = CATALOG[key] || 1100000;
  const age = clamp(new Date().getFullYear() - Number(job.year), 0, 20);
  let value = newPrice * Math.pow(0.87, age);
  if (job.fuel === 'Diesel') value *= 1.03; if (job.fuel === 'CNG') value *= 0.98; if (job.fuel === 'Electric') value *= 1.05;
  const odo = Number(job.expectedOdometer || 50000);
  if (odo > 80000) value *= 0.94; else if (odo < 20000) value *= 1.04;
  value *= 1 + ((seededInt(job.regNumber, 41) - 20) / 1000); // stable ±2% market jitter
  return { marketValue: Math.round(value / 500) * 500, newPrice, ageYears: age, provider: 'DeepSearch-SIM', comparableCount: 12 + seededInt(job.regNumber, 30) };
}

const COST = { dent: { Small: 2500, Medium: 6000, Large: 12000 }, scratch: { Small: 1800, Medium: 3500, Large: 6000 }, rust: { Small: 4000, Medium: 8000, Large: 15000 }, crack: { Small: 3000, Medium: 7000, Large: 14000 }, tire: { Small: 2000, Medium: 4500, Large: 9000 } };
const PARTS_BY_CATEGORY = { FRONT: 'Front bumper/panel', REAR: 'Rear bumper/panel', LEFT: 'Left door/panel', RIGHT: 'Right door/panel', ENGINE: 'Engine bay component', TIRE: 'Tyre', ODOMETER: 'Cluster', DAMAGE: 'Damaged panel', TOP: 'Roof/panel', INTERIOR: 'Interior trim' };
export function analyzeDamage(job, inspection) {
  const images = inspection.images || []; const manual = inspection.damages || [];
  const detections = [];
  images.forEach((img, i) => {
    const types = ['dent', 'scratch', 'rust', 'tire']; const sev = ['Small', 'Medium', 'Large'];
    const seed = seededInt(`${job.id}:${img.category}:${i}`, 100);
    if (img.category === 'ODOMETER' || img.category === 'ENGINE') return;
    if (seed % 3 === 0) return; // ~1/3 panels clean
    const type = img.category === 'TIRE' ? 'tire' : types[seed % 3];
    const severity = sev[seed % 3];
    detections.push({ part: PARTS_BY_CATEGORY[img.category] || img.category, category: img.category, type, severity, confidence: 0.72 + ((seed % 25) / 100), estimatedCost: COST[type][severity], model: 'YOLOv8-SIM + MaskRCNN-SIM' });
  });
  for (const d of manual) if (!detections.some((x) => x.part.toLowerCase() === String(d.part || '').toLowerCase())) detections.push({ part: d.part || 'Panel', category: 'DAMAGE', type: (d.type || 'dent').toLowerCase(), severity: d.severity || 'Medium', confidence: 0.65, estimatedCost: COST[(d.type || 'dent').toLowerCase()]?.[d.severity || 'Medium'] || 5000, model: 'INSPECTOR-CONFIRMED' });
  const total = detections.reduce((s, d) => s + d.estimatedCost, 0);
  return { detections, costBreakdown: { parts: round2(total * 0.6), labor: round2(total * 0.3), paint: round2(total * 0.1), totalDamageCost: total }, tireWearPct: 20 + seededInt(job.regNumber + 'tire', 65), model: 'XGBoost-Cost-SIM', provider: 'AI-DAMAGE-SIM' };
}

export function analyzeFraud(job, inspection) {
  const images = inspection.images || []; const checks = []; let score = 0;
  const seen = new Set(); let dup = false, gpsBad = 0, timeBad = 0, metaMissing = 0;
  const nowMs = Date.now();
  for (const img of images) {
    if (img.imageHash) { if (seen.has(img.imageHash)) dup = true; seen.add(img.imageHash); }
    if (!img.lat || !img.lng) metaMissing++; else if (haversineKm(img.lat, img.lng, job.vehicleLat, job.vehicleLng) > 0.5) gpsBad++;
    const t = img.capturedAt ? new Date(img.capturedAt).getTime() : NaN;
    if (!Number.isNaN(t) && (t > nowMs + 5 * 60000 || t < nowMs - 7 * 86400000)) timeBad++;
  }
  const odoTamper = inspection.odometerReading != null && job.expectedOdometer != null && Number(inspection.odometerReading) < Number(job.expectedOdometer) - 500;
  const chassisMismatch = inspection.chassisNumber && job.verification?.rc?.chassisNumber && String(inspection.chassisNumber).toUpperCase() !== String(job.verification.rc.chassisNumber).toUpperCase();
  const add = (name, fail, detail, w) => { checks.push({ name, status: fail ? 'FAIL' : 'PASS', detail }); if (fail) score += w; };
  add('GPS Geotag Match (killfake.ai)', gpsBad > 0, gpsBad ? `${gpsBad} image(s) >500m from vehicle location` : 'All images within 500m of vehicle', 25);
  add('Timestamp Freshness', timeBad > 0, timeBad ? `${timeBad} image(s) stale/future-dated` : 'All timestamps fresh', 20);
  add('Duplicate / Reused Image', dup, dup ? 'Duplicate image hash detected' : 'No reused images', 30);
  add('EXIF / Metadata Presence', metaMissing > 0, metaMissing ? `${metaMissing} image(s) missing GPS metadata` : 'Metadata complete', 15);
  add('Odometer Tampering', odoTamper, odoTamper ? `Reading ${inspection.odometerReading} < expected ${job.expectedOdometer}` : 'Odometer consistent', 30);
  add('Chassis Number Match', chassisMismatch, chassisMismatch ? 'Chassis does not match RC record' : 'Chassis matches RC', 30);
  score = clamp(score, 0, 100);
  return { fraudScore: score, riskLevel: score > 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW', checks, provider: 'killfake.ai-SIM', model: 'Deepfake+Metadata-SIM' };
}

export function computePlatformScore({ variance, fraudScore, imagesCount, docsCount }) {
  let s = 5 - clamp(Number(variance) / 10, 0, 2);
  if (fraudScore > 60) s -= 1; else if (fraudScore >= 30) s -= 0.4;
  if (imagesCount < 5 || docsCount < 3) s -= 0.5;
  return round2(clamp(s, 1, 5));
}
