import crypto from 'node:crypto';
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
export function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) return Infinity;
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return round2(2 * R * Math.asin(Math.sqrt(a)));
}
// Deterministic seeded hash so simulated providers are stable & testable (same input -> same output)
export function seededInt(str, mod) {
  let h = 2166136261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return Math.abs(h) % mod;
}
export function variancePct(manual, ai) {
  if (!ai || Number(ai) === 0) return 0;
  return round2((Math.abs(Number(manual) - Number(ai)) / Number(ai)) * 100);
}
export const isGreen = (v) => Number(v) <= 5;

// Public report verification code (deterministic from the unguessable job id)
export const verifyCodeFor = (jobId) => 'VT-' + crypto.createHash('sha256').update(String(jobId)).digest('hex').slice(0, 10).toUpperCase();
