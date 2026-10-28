const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
const base = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font-family:Arial,sans-serif;margin:32px;color:#12263a}h1{color:#0b4f8a}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #cbd5e1;padding:8px;text-align:left}.flag-GREEN{color:#15803d;font-weight:bold}.flag-RED{color:#dc2626;font-weight:bold}.badge{background:#e0f2fe;padding:2px 8px;border-radius:10px}</style></head><body>${body}</body></html>`;
export function fullReportHtml({ job, inspection, analysis, valuation, verify = null }) {
  const d = analysis.damage, f = analysis.fraud;
  return base(`Valuation Report ${job.regNumber}`, `<h1>Valuation Techno — Full Valuation Report (Bank)</h1>
  <p><span class="badge">${esc(job.regNumber)}</span> ${esc(job.make)} ${esc(job.model)} ${esc(job.variant || '')} (${job.year}, ${esc(job.fuel || '')}) · Loan Ref: ${esc(job.loanRef || '-')}</p>
  ${verify ? `<h2>Verify This Report</h2><table><tr><td style="width:130px">${verify.qrDataUrl ? `<img src="${verify.qrDataUrl}" width="120" height="120" alt="Report verification QR code"/>` : ''}</td><td>Verification Code: <b>${esc(verify.code)}</b><br/>Scan the QR code or open:<br/><span class="badge">${esc(verify.url)}</span><br/>Anyone can confirm this report is genuine and untampered.</td></tr></table>` : ''}
  <h2>Dual Valuation & Variance</h2><table><tr><th>AI Valuation</th><th>Inspector (Manual) Valuation</th><th>Variance</th><th>Flag</th><th>Final Valuation</th></tr>
  <tr><td>${inr(valuation.aiValuation)}</td><td>${inr(valuation.manualValuation)}</td><td>${valuation.variancePct}%</td><td class="flag-${valuation.flag}">${valuation.flag} FLAG</td><td><b>${inr(valuation.finalValuation)}</b></td></tr></table>
  <p>Market value (DeepSearch): ${inr(valuation.marketValue)} · Reasons: ${esc((valuation.varianceReasons || []).join('; '))}</p>
  <h2>Damage Cost Breakdown (annotated)</h2><table><tr><th>Part</th><th>Type</th><th>Severity</th><th>Confidence</th><th>Annotation</th><th>Cost</th></tr>${d.detections.map((x) => `<tr><td>${esc(x.part)}</td><td>${esc(x.type)}</td><td>${esc(x.severity)}</td><td>${Math.round(x.confidence * 100)}%</td><td>▣ ${esc(x.type)} @ ${esc(x.part)} [${esc(x.model)}]</td><td>${inr(x.estimatedCost)}</td></tr>`).join('') || '<tr><td colspan="6">No damage detected</td></tr>'}</table>
  <p>Parts ${inr(d.costBreakdown.parts)} · Labor ${inr(d.costBreakdown.labor)} · Paint ${inr(d.costBreakdown.paint)} · <b>Total ${inr(d.costBreakdown.totalDamageCost)}</b> · Tire wear ${d.tireWearPct}%</p>
  <h2>Fraud Risk (killfake.ai)</h2><p>Score: <b>${f.fraudScore}/100 (${esc(f.riskLevel)})</b></p><table><tr><th>Check</th><th>Status</th><th>Detail</th></tr>${f.checks.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.status)}</td><td>${esc(c.detail)}</td></tr>`).join('')}</table>
  <h2>Verification History</h2><p>Accidents: ${job.verification?.history?.accidentCount ?? '-'} · Claims: ${job.verification?.history?.claimCount ?? '-'} · Insurance valid: ${job.verification?.insurance?.valid ? 'Yes' : 'No'}</p>
  <h2>Inspection Evidence</h2><table><tr><th>Category</th><th>Captured At</th><th>Geo (lat,lng)</th><th>File</th></tr>${(inspection?.images || []).map((i) => `<tr><td>${esc(i.category)}</td><td>${esc(i.capturedAt || '')}</td><td>${esc(i.lat ?? '')}, ${esc(i.lng ?? '')}</td><td>${esc(i.originalName || i.filename || 'metadata-only')}</td></tr>`).join('')}</table>
  <p>Odometer: ${inspection?.odometerReading ?? '-'} km · Generated ${new Date().toLocaleString('en-IN')} · Valuation Techno</p>`);
}
export function summaryReportHtml({ job, valuation }) {
  return base(`Valuation Summary ${job.regNumber}`, `<h1>Valuation Techno — Valuation Summary</h1>
  <p>${esc(job.make)} ${esc(job.model)} (${job.year}) · ${esc(job.regNumber)}</p>
  <table><tr><th>Final Valuation</th><th>Status</th></tr><tr><td><b>${inr(valuation.finalValuation)}</b></td><td class="flag-${valuation.flag}">${valuation.flag === 'GREEN' ? 'Approved' : 'Under Review'}</td></tr></table>
  <p>Your vehicle inspection is complete. The bank will share the final loan decision. Thank you for using Valuation Techno.</p>`);
}
