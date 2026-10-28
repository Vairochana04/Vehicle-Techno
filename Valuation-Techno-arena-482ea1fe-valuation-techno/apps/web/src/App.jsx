import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api, token, sessionUser, setSession, clearSession, inr, fmtDate, openAuthed, blobUrl, logoutApi } from './api.js';
import { carPhotoFor } from './carPhotos.js';
import { FraudGauge, CarTwin, AiScanPanel, MarketChart, LiveMap, AnalyticsPanel, ErrorBoundary, CarShowcase, ValuationDuel, CelebrationHost, SuccessTick, fireCelebration, ChatBox } from './components/Advanced.jsx';
import AdminControlCenter from './components/AdminDashboard.jsx';

const PHASES = ['BROADCAST', 'ASSIGNED', 'INSPECTION_IN_PROGRESS', 'INSPECTION_SUBMITTED', 'AUDIT_REQUIRED', 'REPORT_DELIVERED', 'SETTLED'];
const ROLE_META = {
  BANK: { icon: '🏦', title: 'Bank Officer Dashboard', color: '#0a1424', home: 'Create valuation jobs, track reports & settle payments' },
  INSPECTOR: { icon: '🔍', title: 'Inspector Dashboard', color: '#0a1424', home: 'Jobs near you, inspections, instant-pay earnings & your rating' },
  LOAN_SEEKER: { icon: '🚗', title: 'My Vehicle Valuation', color: '#0a1424', home: 'Track your valuation, download your summary report & rate your inspector' },
  ADMIN: { icon: '🛡️', title: 'Platform Control Tower', color: '#0a1424', home: 'RED-flag audit queue, inspector governance, money & AI analytics' },
};
function StatusPill({ s }) { return <span className="pill">{s}</span>; }
function Stepper({ status }) { const idx = PHASES.indexOf(status); return <div className="stepper">{PHASES.map((p, i) => <span key={p} className={`step ${i <= idx ? 'on' : ''}`}>{p.replaceAll('_', ' ')}</span>)}</div>; }

// Button that ALWAYS responds: spinner while working, disabled, and shows errors instead of silently failing.
export function Btn({ action, children, className = '', green, danger, ghost }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
    <button type="button" disabled={busy} className={`${className} ${green ? 'green' : ''} ${danger ? 'danger' : ''} ${ghost ? 'ghost' : ''}`}
      onClick={async () => { setBusy(true); setErr(''); try { await action(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }}>
      {busy ? '⏳ Working…' : children}</button>
    {err && <span style={{ color: '#fb7185', fontSize: 12, maxWidth: 320 }}>{err}</span>}</span>;
}

function Login() {
  const nav = useNavigate(); const [form, setForm] = useState({ email: '', password: '' }); const [reg, setReg] = useState({ name: '', email: '', password: '', phone: '', role: 'LOAN_SEEKER' });
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(() => { const n = sessionStorage.getItem('vt_notice'); sessionStorage.removeItem('vt_notice'); return n || ''; }); const [mode, setMode] = useState('login'); const [otp, setOtp] = useState(null);
  const doLogin = async (email, password) => { const d = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); setSession(d.token, d.user); nav('/dashboard'); };
  const demos = [['🏦 Bank (HDFC)', 'bank@valuation.techno', 'Bank@123', 'Creates jobs, gets FULL report, settles'], ['🔍 Inspector Ravi ★4.6', 'inspector@valuation.techno', 'Inspector@123', 'Accepts jobs, inspects, gets instant pay'], ['🚗 Loan Seeker', 'seeker@valuation.techno', 'Seeker@123', 'Sees SUMMARY report, rates inspector'], ['🛡️ Platform Admin', 'admin@valuation.techno', 'Admin@123', 'Audits RED flags, controls platform']];
  return <div className="wrap login-page"><div className="card login"><h1>Valuation Techno</h1><p className="muted">Smart Valuation. Safer Transactions — AI-powered used vehicle valuation & FinTech platform. <b>Each login opens a different dashboard.</b></p><CarShowcase />
    {err && <div className="err">{err}</div>}{msg && <div className="ok">{msg}</div>}
    <div className="tabs"><button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Login</button><button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Register</button><button className={mode === 'otp' ? 'on' : ''} onClick={() => setMode('otp')}>OTP Login</button></div>
    {mode === 'login' && <><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@bank.com" /><label>Password</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <Btn action={() => doLogin(form.email, form.password)}>Login →</Btn>
      <p className="muted">One-click demo logins (each is a DIFFERENT dashboard):</p><div className="demo">{demos.map(([l, e, p, desc]) => <Btn key={e} ghost action={() => doLogin(e, p)}>{l} — {desc}</Btn>)}</div></>}
    {mode === 'register' && <><label>Full name</label><input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} /><label>Email</label><input value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} /><label>Phone</label><input value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} placeholder="+91..." /><label>Role</label><select value={reg.role} onChange={(e) => setReg({ ...reg, role: e.target.value })}><option value="BANK">Bank</option><option value="INSPECTOR">Inspector</option><option value="LOAN_SEEKER">Loan Seeker</option></select><label>Password (min 6 chars)</label><input type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} />
      <Btn action={async () => { const d = await api('/auth/register', { method: 'POST', body: JSON.stringify(reg) }); setSession(d.token, d.user); nav('/dashboard'); }}>Create account →</Btn></>}
    {mode === 'otp' && <><label>Phone (demo: +919000000003 = Inspector Ravi)</label><input id="otp-phone" placeholder="+919000000003" />
      <Btn ghost action={async () => { const d = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone: document.getElementById('otp-phone').value }) }); setOtp(d.demoOtp); setMsg(`OTP sent to your phone${d.demoOtp ? ` (demo OTP: ${d.demoOtp})` : ''}`); }}>Send OTP</Btn>
      <label>OTP</label><input id="otp-code" placeholder="6-digit OTP" />
      <Btn action={async () => { const d = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone: document.getElementById('otp-phone').value, code: document.getElementById('otp-code').value }) }); setSession(d.token, d.user); nav('/dashboard'); }}>Verify & Login →</Btn></>}
  </div></div>;
}

function InspectionForm({ job, reload }) {
  const cats = ['FRONT', 'REAR', 'ENGINE', 'TIRE', 'ODOMETER'];
  const draftKey = `vt_draft_${job.id}`;
  const draft = (() => { try { return JSON.parse(localStorage.getItem(draftKey)); } catch { return null; } })();
  const [f, setF] = useState(draft?.f || { odometerReading: job.expectedOdometer || 45000, manualValuation: '', manualRepairEstimate: 5000, notes: 'Vehicle in good condition' });
  const [damages, setDamages] = useState(draft?.damages || [{ part: 'Front bumper/panel', type: 'scratch', severity: 'Small', description: 'Minor scratch' }]);
  const [images, setImages] = useState(draft?.images || cats.map((category, i) => ({ category, lat: job.vehicleLat, lng: job.vehicleLng, capturedAt: new Date().toISOString(), imageHash: `img-${job.id}-${i}-${Math.random().toString(36).slice(2, 8)}` })));
  const [err, setErr] = useState(''); const [done, setDone] = useState('');
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify({ f, damages, images })); } catch { /* non-fatal */ } }, [f, damages, images]);
  const upload = async (e, idx) => { const file = e.target.files[0]; if (!file) return; const fd = new FormData(); fd.append('file', file); fd.append('category', images[idx].category); fd.append('lat', images[idx].lat); fd.append('lng', images[idx].lng);
    const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd }); const d = await res.json(); if (!res.ok) return setErr(d.error || 'Upload failed');
    setImages(images.map((im, i) => i === idx ? { ...im, imageHash: d.imageHash, filename: d.filename, originalName: d.originalName } : im)); setDone(`Uploaded ${d.originalName} ✓`); };
  return <div style={{ marginTop: 14 }}><h3>🔍 On-Site Inspection (Phase 2)</h3>{err && <div className="err">{err}</div>}{done && <div className="ok">{done}</div>}
    <div className="row"><div><label>Odometer reading (km)</label><input type="number" value={f.odometerReading} onChange={(e) => setF({ ...f, odometerReading: Number(e.target.value) })} /></div><div><label>Your manual valuation (₹) *</label><input type="number" value={f.manualValuation} onChange={(e) => setF({ ...f, manualValuation: e.target.value })} placeholder="e.g. 735000" /></div></div>
    <div className="row"><div><label>Manual repair estimate (₹)</label><input type="number" value={f.manualRepairEstimate} onChange={(e) => setF({ ...f, manualRepairEstimate: Number(e.target.value) })} /></div><div><label>Notes</label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div></div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Btn ghost action={async () => { if (!navigator.geolocation) throw new Error('Geolocation not supported'); const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej)); setImages(images.map((im) => ({ ...im, lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)), capturedAt: new Date().toISOString() }))); setDone('Live GPS stamped on all photos ✓'); }}>📍 Use My Live GPS</Btn>
      <Btn ghost action={async () => { try { const stream = await navigator.mediaDevices.getUserMedia({ video: true }); const v = document.getElementById('vt-cam'); v.srcObject = stream; v.style.display = 'block'; document.getElementById('vt-shoot').style.display = 'inline-flex'; } catch (e) { throw new Error('Camera unavailable: ' + e.message); } }}>📷 Open Camera</Btn>
      <span id="vt-shoot" style={{ display: 'none' }}><Btn green action={async () => { const v = document.getElementById('vt-cam'); const c = document.getElementById('vt-canvas'); c.width = v.videoWidth || 640; c.height = v.videoHeight || 480; c.getContext('2d').drawImage(v, 0, 0); const data = c.toDataURL('image/jpeg', 0.7); let h = 0; for (const ch of data) h = ((h << 5) - h + ch.charCodeAt(0)) | 0; setImages(images.map((im, idx) => idx === 0 ? { ...im, imageHash: 'cam-' + Math.abs(h).toString(16) + data.length, originalName: 'camera-capture.jpg', capturedAt: new Date().toISOString() } : im)); v.srcObject?.getTracks().forEach((tr) => tr.stop()); v.style.display = 'none'; document.getElementById('vt-shoot').style.display = 'none'; setDone('Front photo captured from camera ✓'); }}>Capture Front Photo</Btn></span>
    </div>
    <video id="vt-cam" autoPlay playsInline style={{ display: 'none', width: '100%', maxHeight: 260, borderRadius: 12, background: '#000' }}></video><canvas id="vt-canvas" style={{ display: 'none' }}></canvas>
    <label>Geotagged photos — upload real photos (hashed for killfake checks) or keep the pre-filled geo/time metadata</label>
    {images.map((im, i) => <div key={i} className="row"><div><span className="pill">{im.category}</span> <span className="muted">{im.lat}, {im.lng} · {fmtDate(im.capturedAt)}{im.originalName ? ` · ${im.originalName} ✓` : ''}</span></div><div><input type="file" accept="image/*,.pdf" onChange={(e) => upload(e, i)} /></div></div>)}
    <label>Observed damages</label>{damages.map((d, i) => <div key={i} className="row"><input value={d.part} onChange={(e) => setDamages(damages.map((x, j) => j === i ? { ...x, part: e.target.value } : x))} placeholder="Part e.g. Front bumper" /><select value={d.severity} onChange={(e) => setDamages(damages.map((x, j) => j === i ? { ...x, severity: e.target.value } : x))}><option>Small</option><option>Medium</option><option>Large</option></select></div>)}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Btn ghost action={async () => setDamages([...damages, { part: '', type: 'dent', severity: 'Medium', description: '' }])}>+ Add damage</Btn>
    <Btn action={async () => { if (!f.manualValuation) throw new Error('Enter your manual valuation first'); await api(`/jobs/${job.id}/inspection`, { method: 'POST', body: JSON.stringify({ ...f, manualValuation: Number(f.manualValuation), condition: { engine: 4, body: 4, tires: 3, interior: 4 }, damages, images, documents: [{ type: 'RC' }, { type: 'INSURANCE' }, { type: 'POLLUTION' }] }) }); localStorage.removeItem(draftKey); await reload(); }}>Submit Inspection · Instant Pay + AI →</Btn></div>
    <p className="muted">On submit: ₹1,200 instant pay posts, AI damage/fraud runs, dual valuation & Red/Green flag compute automatically. Draft auto-saves offline as you type.</p></div>;
}

function AuditBox({ job, reload }) {
  const [finalValuation, setFinal] = useState(''); const [note, setNote] = useState('');
  return <div style={{ marginTop: 14 }}><h3>🔴 Red Flag Audit (Admin / Senior Review)</h3><label>Senior-approved final valuation (₹, blank = average of AI + manual)</label><input type="number" value={finalValuation} onChange={(e) => setFinal(e.target.value)} /><label>Audit note</label><input value={note} onChange={(e) => setNote(e.target.value)} />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <Btn green action={async () => { await api(`/jobs/${job.id}/audit`, { method: 'POST', body: JSON.stringify({ action: 'APPROVE', finalValuation: finalValuation ? Number(finalValuation) : undefined, note }) }); await reload(); }}>✓ Approve</Btn>
      <Btn action={async () => { await api(`/jobs/${job.id}/audit`, { method: 'POST', body: JSON.stringify({ action: 'SENIOR_REVIEW', finalValuation: finalValuation ? Number(finalValuation) : undefined, note }) }); await reload(); }}>Senior Review Approve</Btn>
      <Btn danger action={async () => { await api(`/jobs/${job.id}/audit`, { method: 'POST', body: JSON.stringify({ action: 'RE_INSPECTION', note }) }); await reload(); }}>↺ Order Re-inspection</Btn></div></div>;
}
function RateBox({ job, reload }) {
  const [r, setR] = useState({ professionalism: 5, punctuality: 5, communication: 5, thoroughness: 5, feedback: '' });
  return <div style={{ marginTop: 14 }}><h3>⭐ Rate your inspector</h3>
    {['professionalism', 'punctuality', 'communication', 'thoroughness'].map((k) => <div key={k}><label>{k} (1–5): {r[k]}</label><input type="range" min="1" max="5" value={r[k]} onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })} /></div>)}
    <label>Feedback</label><input value={r.feedback} onChange={(e) => setR({ ...r, feedback: e.target.value })} />
    <Btn action={async () => { await api(`/jobs/${job.id}/rate`, { method: 'POST', body: JSON.stringify(r) }); await reload(); }}>Submit Rating →</Btn></div>;
}
function BankFeedbackBox({ job, reload }) {
  const [r, setR] = useState({ reportQuality: 5, timeliness: 5, accuracy: 5, comment: '' });
  return <div style={{ marginTop: 14 }}><h3>🏦 Bank Feedback on Report</h3>
    {['reportQuality', 'timeliness', 'accuracy'].map((k) => <div key={k}><label>{k} (1–5): {r[k]}</label><input type="range" min="1" max="5" value={r[k]} onChange={(e) => setR({ ...r, [k]: Number(e.target.value) })} /></div>)}
    <label>Comment</label><input value={r.comment} onChange={(e) => setR({ ...r, comment: e.target.value })} />
    <Btn action={async () => { await api(`/jobs/${job.id}/bank-feedback`, { method: 'POST', body: JSON.stringify(r) }); await reload(); }}>Submit Bank Feedback →</Btn></div>;
}

function LiveShare({ job }) {
  const [on, setOn] = useState(false); const [msg, setMsg] = useState(''); const watch = useRef(null); const last = useRef(0);
  useEffect(() => () => { if (watch.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watch.current); }, []);
  const toggle = () => {
    if (on) { if (navigator.geolocation && watch.current != null) navigator.geolocation.clearWatch(watch.current); setOn(false); setMsg('Live location sharing stopped.'); return; }
    if (!navigator.geolocation) { setMsg('GPS is not available on this device/browser.'); return; }
    watch.current = navigator.geolocation.watchPosition((pos) => {
      const t = Date.now(); if (t - last.current < 8000) return; last.current = t;
      api(`/jobs/${job.id}/location`, { method: 'POST', body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }) })
        .then(() => setMsg('📡 Live location is being shared with the bank.')).catch((e) => setMsg(e.message));
    }, (e) => setMsg(e.message), { enableHighAccuracy: true });
    setOn(true); setMsg('Starting live location sharing…');
  };
  return <div style={{ marginTop: 12 }}><Btn action={async () => toggle()}>{on ? '🛑 Stop Live Location' : '📡 Share Live Location'}</Btn>{msg && <span className="muted" style={{ marginLeft: 8 }}>{msg}</span>}</div>;
}

// QR code image loaded through the authenticated session (blob URL).
// A plain <img src="/api/..."> shows a broken icon inside preview frames
// because the image request cannot carry the login token / cookie.
function QrImage({ jobId }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let url = ''; let alive = true;
    blobUrl(`/jobs/${jobId}/qr`).then((u) => { url = u; if (alive) setSrc(u); else URL.revokeObjectURL(u); }).catch(() => {});
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [jobId]);
  if (!src) return <div className="muted" style={{ width: 110, height: 110, display: 'grid', placeItems: 'center', background: '#fff', borderRadius: 10, fontSize: 12, color: '#33415c' }}>QR…</div>;
  return <img src={src} alt="Report verification QR code" width="110" height="110" style={{ background: '#fff', padding: 6, borderRadius: 10 }} />;
}

function JobDetail({ job, user, reload, onClose }) {
  if (!job) return null; const v = job.valuation;
  return <div className="card" style={{ border: '2px solid #38bdf8' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><h2>{job.make} {job.model} {job.variant || ''} ({job.year}) · {job.regNumber}</h2><Btn ghost action={async () => onClose()}>✕ Close</Btn></div><img className="job-hero-img" src={carPhotoFor(job)} alt={`${job.make} ${job.model}`} /><Stepper status={job.status} />
    <p><StatusPill s={job.status} /> <span className="muted">Loan: {job.loanRef || '—'} · Seeker: {job.seekerName} · Fee: {inr(job.valuationFee)} · Mode: {job.allocationMode} · Radius: {job.broadcastRadiusKm} km</span></p>
    {job.verification && <details open><summary><b>Vehicle Verification (VAHAN / IIB)</b></summary><table><tbody>{job.verification.checks?.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.status}</td><td>{c.detail}</td></tr>)}</tbody></table><p className="muted">Accidents: {job.verification.history?.accidentCount} · Claims: {job.verification.history?.claimCount} · Owners: {job.verification.ownership?.ownersCount} · Insurance valid: {job.verification.insurance?.valid ? 'Yes' : 'No'}</p></details>}
    {job.assignedInspector && <p>Inspector: <b>{job.assignedInspector.name}</b> ★ {job.assignedInspector.rating} ({job.assignedInspector.status})</p>}
    {!job.assignedInspector && job.eligibleInspectors?.length > 0 && <p className="muted">Eligible inspectors in radius: {job.eligibleInspectors.map((i) => `${i.name} ★${i.rating} (${i.distanceKm} km)`).join(' · ')}</p>}
    {v && <div><h3>Dual Valuation</h3><table><tbody><tr><td>Market (DeepSearch)</td><td>{inr(v.marketValue)}</td><td>AI Valuation</td><td>{inr(v.aiValuation)}</td></tr><tr><td>Manual Valuation</td><td>{inr(v.manualValuation)}</td><td>Variance</td><td>{v.variancePct}% <span className={`flag ${v.flag}`}>{v.flag} FLAG</span></td></tr><tr><td>Final Valuation</td><td><b>{inr(v.finalValuation)}</b></td><td>Status</td><td>{v.status}</td></tr></tbody></table><p className="muted">{(v.varianceReasons || []).join('; ')}</p>{user.role !== 'LOAN_SEEKER' && v.aiValuation != null && <ValuationDuel v={v} />}</div>}
    {job.analysis && user.role !== 'LOAN_SEEKER' && <details open><summary><b>AI Damage & Fraud (killfake.ai)</b></summary><p>Damage total: {inr(job.analysis.damage.costBreakdown.totalDamageCost)} · Tire wear {job.analysis.damage.tireWearPct}% · Fraud: <b>{job.analysis.fraud.riskLevel} ({job.analysis.fraud.fraudScore}/100)</b></p><table><tbody>{job.analysis.fraud.checks.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.status}</td><td>{c.detail}</td></tr>)}</tbody></table></details>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      {user.role === 'INSPECTOR' && job.status === 'BROADCAST' && <Btn action={async () => { await api(`/jobs/${job.id}/accept`, { method: 'POST' }); await reload(); }}>✓ Accept Job (exclusive)</Btn>}
      {user.role === 'INSPECTOR' && job.status === 'ASSIGNED' && <Btn action={async () => { await api(`/jobs/${job.id}/start`, { method: 'POST' }); await reload(); }}>▶ Start Inspection</Btn>}
      {v?.finalValuation && <Btn ghost action={() => openAuthed(`/api/jobs/${job.id}/report`)}>📄 View {user.role === 'LOAN_SEEKER' ? 'Summary' : 'Full'} Report</Btn>}
      {v?.finalValuation && <Btn ghost action={() => openAuthed(`/api/jobs/${job.id}/report.pdf`)}>⬇ Download PDF</Btn>}
      {(user.role === 'BANK' || user.role === 'ADMIN') && job.status === 'REPORT_DELIVERED' && <Btn green action={async () => { await api(`/jobs/${job.id}/settle`, { method: 'POST' }); await reload(); }}>💰 Settle Payment</Btn>}
      {(user.role === 'ADMIN' || user.role === 'BANK') && job.status === 'AUDIT_REQUIRED' && user.role === 'BANK' && <span className="muted">⏳ Waiting for Admin audit (RED flag)</span>}
    </div>
    {user.role === 'INSPECTOR' && job.assignedInspector?.id === user.id && ['ASSIGNED', 'INSPECTION_IN_PROGRESS'].includes(job.status) && <LiveShare job={job} />}
    {user.role === 'INSPECTOR' && ['ASSIGNED', 'INSPECTION_IN_PROGRESS'].includes(job.status) && <InspectionForm job={job} reload={reload} />}
    {job.verifyCode && <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}><QrImage jobId={job.id} /><p style={{ margin: 0 }}>🔐 <b>Report Verification</b><br />Verification Code: <b>{job.verifyCode}</b><br /><span className="muted">Scan this QR code (it is also printed at the top of the full report & PDF), or</span> <a href={`/verify/${job.verifyCode}`} target="_blank" rel="noreferrer">open the public verification page</a></p></div>}
    {['BANK', 'INSPECTOR', 'ADMIN'].includes(user.role) && <ChatBox jobId={job.id} me={user} />}
    {user.role === 'ADMIN' && job.status === 'AUDIT_REQUIRED' && <AuditBox job={job} reload={reload} />}
    {user.role === 'LOAN_SEEKER' && job.status === 'REPORT_DELIVERED' && !job.rating && <RateBox job={job} reload={reload} />}
    {user.role === 'BANK' && ['REPORT_DELIVERED', 'SETTLED'].includes(job.status) && !job.bankFeedback && <BankFeedbackBox job={job} reload={reload} />}
    {job.rating && <p className="ok">Rating: Seeker {job.rating.seekerScore}/5 · Platform {job.rating.platformScore}/5 · <b>Composite {job.rating.composite}/5</b> (0.4×Seeker + 0.6×Platform)</p>}
    {job.bankFeedback && <p className="ok">Bank feedback: <b>{job.bankFeedback.avgScore}/5</b></p>}
    {job.analysis && user.role !== 'LOAN_SEEKER' && <div className="card" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}><FraudGauge score={job.analysis.fraud.fraudScore} risk={job.analysis.fraud.riskLevel} /><CarTwin detections={job.analysis.damage.detections} /><div style={{ flex: 1, minWidth: 260 }}><AiScanPanel analysis={job.analysis} /></div></div>}
    {user.role !== 'LOAN_SEEKER' && <div className="card"><LiveMap job={job} /><MarketChart make={job.make} model={job.model} /></div>}
    {user.role !== 'LOAN_SEEKER' && job.ledger?.length > 0 && <details open><summary><b>Payments & Ledger</b></summary><table><tbody>{job.ledger.map((l) => <tr key={l.id}><td>{l.type}</td><td>{l.fromParty} → {l.toParty}</td><td>{inr(l.amount)}</td><td>{l.status}</td></tr>)}</tbody></table></details>}
  </div>;
}

function Dashboard() {
  const user = sessionUser(); const nav = useNavigate();
  const [jobs, setJobs] = useState([]); const [selId, setSelId] = useState(null); const [overview, setOverview] = useState(null);
  const [inspectors, setInspectors] = useState([]); const [users, setUsers] = useState([]); const [ledger, setLedger] = useState([]); const [notifs, setNotifs] = useState([]);
  const [tab, setTab] = useState('jobs'); const [err, setErr] = useState(''); const [banner, setBanner] = useState('');
  const [liveEvents, setLiveEvents] = useState([]); const [liveOn, setLiveOn] = useState(false); const [createdJob, setCreatedJob] = useState(null);
  const [jobForm, setJobForm] = useState({ seekerName: 'Demo Loan Seeker', seekerPhone: '+919000000006', seekerEmail: 'seeker@valuation.techno', loanRef: 'LOAN-1001', regNumber: 'TN38AB1234', make: 'Hyundai', model: 'Creta', variant: 'SX', year: 2020, fuel: 'Petrol', vehicleLat: 11.0168, vehicleLng: 76.9558, city: 'Coimbatore', expectedOdometer: 45000, valuationFee: 2500 });
  const sel = jobs.find((j) => j.id === selId) || null;
  const reload = async () => {
    const j = await api('/jobs'); setJobs(j);
    if (user.role === 'ADMIN' || user.role === 'BANK') { setOverview(await api('/admin/overview')); setLedger(await api('/admin/ledger')); if (user.role === 'ADMIN') { setInspectors(await api('/admin/inspectors')); setUsers(await api('/admin/users')); } }
    if (user.role === 'INSPECTOR') setLedger(await api('/admin/ledger'));
    setNotifs(await api('/admin/notifications')); return j;
  };
  useEffect(() => { reload().catch((e) => setErr(e.message)); }, []);
  const prevStatus = useRef({});
  useEffect(() => { // celebration watcher: report delivery & settlement, from any role, live
    jobs.forEach((j) => {
      const prev = prevStatus.current[j.id];
      if (prev && prev !== j.status && j.status === 'REPORT_DELIVERED') fireCelebration(`Report Delivered · ${j.regNumber}`);
      if (prev && prev !== j.status && j.status === 'SETTLED') fireCelebration(`Payment Settled · ${j.regNumber}`);
      prevStatus.current[j.id] = j.status;
    });
  }, [jobs]);
  const [toasts, setToasts] = useState([]); const lastToast = useRef('');
  useEffect(() => { const e = liveEvents[0]; if (!e || !e.at || e.at === lastToast.current) return; lastToast.current = e.at;
    const id = `${e.at}-${Math.random()}`; setToasts((t) => [{ id, text: `${e.type.replaceAll('_', ' ')} ${e.regNumber || ''}` }, ...t].slice(0, 3));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000); }, [liveEvents]);
  useEffect(() => { // live channel: updates the data, but market ticks must not force full reloads
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'; const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token() || '')}`);
    ws.onopen = () => setLiveOn(true); ws.onclose = () => setLiveOn(false);
    ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (['CONNECTED', 'PONG', 'MARKET_TICK'].includes(m.type)) return; setLiveEvents((p) => [m, ...p].slice(0, 12)); setBanner(`⚡ ${m.type} ${m.regNumber || ''}`); reload().catch(() => {}); } catch { /* resilient */ } };
    const ping = setInterval(() => { try { ws.send(JSON.stringify({ type: 'PING' })); } catch { /* noop */ } }, 25000);
    return () => { clearInterval(ping); ws.close(); };
  }, []);
  if (!user) return <Navigate to="/" />;
  const meta = ROLE_META[user.role] || ROLE_META.LOAN_SEEKER;
  const available = jobs.filter((j) => j.status === 'BROADCAST');
  const myTasks = jobs.filter((j) => j.assignedInspector?.id === user.id || (j.status !== 'BROADCAST' && user.role === 'INSPECTOR'));
  const auditQueue = jobs.filter((j) => j.status === 'AUDIT_REQUIRED');
  const toSettle = jobs.filter((j) => j.status === 'REPORT_DELIVERED');
  const earnings = ledger.filter((l) => ['INSPECTOR_INSTANT_PAY', 'INSPECTOR_BONUS'].includes(l.type)).reduce((s, l) => s + l.amount, 0);
  const open = (j) => { setSelId(j.id); document.getElementById('job-detail')?.scrollIntoView({ behavior: 'smooth' }); };
  return <div><div className="push-stack">{toasts.map((t) => <div key={t.id} className="push-toast">🔔 {t.text}</div>)}</div><header className="topbar" style={{ background: meta.color }}><div><div className="brand">{meta.icon} Valuation <span>Techno</span></div><div className="tag">{meta.title} · {meta.home}</div></div>
    <div style={{ textAlign: 'right' }}>{user.name} · <b>{user.role}</b>{user.role === 'INSPECTOR' ? ` · ★ ${user.rating}` : ''}<br /><Btn ghost action={async () => { await logoutApi(); nav('/'); }}>Logout</Btn></div></header>
  <div className="wrap">{err && <div className="err">{err}</div>}{banner && <div className="ok">{banner} <Btn ghost action={async () => setBanner('')}>OK</Btn></div>}
    <div className="toastbar"><span className="live-dot"></span> {liveOn ? 'LIVE — real-time updates connected (no refresh needed)' : 'Connecting live channel…'}{liveEvents[0] ? ` · Latest: ${liveEvents[0].type} ${liveEvents[0].regNumber || ''}` : ''}</div>

    {user.role === 'BANK' && <><div className="grid"><div className="card"><div className="muted">My valuation jobs</div><div className="stat">{jobs.length}</div></div><div className="card"><div className="muted">Waiting audit (RED)</div><div className="stat">{overview?.auditRequired ?? '—'}</div></div><div className="card"><div className="muted">Reports delivered</div><div className="stat">{overview?.delivered ?? '—'}</div></div><div className="card"><div className="muted">Settled via platform</div><div className="stat">{inr(overview?.ledgerTotal)}</div></div></div>
    <div className="card"><h2>🏦 Phase 1 — Create Valuation Job</h2>
      <div className="row"><div><label>Loan seeker name</label><input value={jobForm.seekerName} onChange={(e) => setJobForm({ ...jobForm, seekerName: e.target.value })} /></div><div><label>Seeker email (seeker login sees this job)</label><input value={jobForm.seekerEmail} onChange={(e) => setJobForm({ ...jobForm, seekerEmail: e.target.value })} /></div></div>
      <div className="row"><div><label>Registration number</label><input value={jobForm.regNumber} onChange={(e) => setJobForm({ ...jobForm, regNumber: e.target.value })} /></div><div><label>Loan reference</label><input value={jobForm.loanRef} onChange={(e) => setJobForm({ ...jobForm, loanRef: e.target.value })} /></div></div>
      <div className="row"><div><label>Make</label><input value={jobForm.make} onChange={(e) => setJobForm({ ...jobForm, make: e.target.value })} /></div><div><label>Model</label><input value={jobForm.model} onChange={(e) => setJobForm({ ...jobForm, model: e.target.value })} /></div></div>
      <div className="row"><div><label>Year</label><input type="number" value={jobForm.year} onChange={(e) => setJobForm({ ...jobForm, year: Number(e.target.value) })} /></div><div><label>Vehicle GPS (lat, lng)</label><input value={`${jobForm.vehicleLat}, ${jobForm.vehicleLng}`} onChange={(e) => { const [a, b] = e.target.value.split(',').map(Number); setJobForm({ ...jobForm, vehicleLat: a, vehicleLng: b }); }} /></div></div>
      <Btn action={async () => {
        if (!jobForm.regNumber || jobForm.regNumber.trim().length < 6) throw new Error('Please enter a valid registration number (e.g., TN38AB1234)');
        if (!jobForm.make.trim() || !jobForm.model.trim()) throw new Error('Please enter the vehicle make and model');
        if (!jobForm.year || jobForm.year < 1990) throw new Error('Please enter a valid vehicle year');
        const j = await api('/jobs', { method: 'POST', body: JSON.stringify(jobForm) });
        setCreatedJob(j); fireCelebration(`Job Created & Broadcast · ${j.regNumber}`); await reload(); setTab('jobs'); setSelId(j.id);
        setBanner(`✓ ${j.regNumber} verified and broadcast successfully. Inspectors have been notified in real time.`);
        setTimeout(() => document.getElementById('created-job-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
      }}>Verify Vehicle + Broadcast →</Btn>
      <p className="muted">On create: VAHAN RC + IIB insurance/claims check runs, seeker fee posts, nearby inspectors get it LIVE.</p>
      {createdJob && <div id="created-job-result" className="ok" style={{ textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><SuccessTick size={44} /><b>✅ JOB CREATED SUCCESSFULLY!</b></div>
        🚗 {createdJob.make} {createdJob.model} · {createdJob.regNumber} · Status: <b>{createdJob.status}</b> (live broadcast sent to eligible inspectors)<br/>
        <b>Verification Results:</b><br/>
        {(createdJob.verification?.checks || []).map((c) => <span key={c.name}>• {c.name}: <b>{c.status}</b> — {c.detail}<br/></span>)}
        📍 <b>Nearby Inspectors:</b> {(createdJob.eligibleInspectors || []).length ? createdJob.eligibleInspectors.map((i) => `${i.name} ★${i.rating} (${i.distanceKm} km)`).join(' · ') : 'No inspectors are currently available within the broadcast radius. Please ask the administrator to review the radius settings.'}<br/>
        <span className="muted">Log in as an Inspector (demo: inspector@valuation.techno) to view this job in real time, accept it, and start the inspection. Alternatively, open the job from the 'All Jobs' section below to view its full details.</span>
        <div style={{ marginTop: 8 }}><Btn ghost action={async () => { setSelId(createdJob.id); setTimeout(() => document.getElementById('job-detail')?.scrollIntoView({ behavior: 'smooth' }), 200); }}>📄 View Full Job Details ↓</Btn></div>
      </div>}</div>
    {toSettle.length > 0 && <div className="card"><h3>💰 Ready to Settle ({toSettle.length})</h3>{toSettle.map((j) => <p key={j.id}>{j.regNumber} · Final {inr(j.valuation?.finalValuation)} <Btn green action={async () => { await api(`/jobs/${j.id}/settle`, { method: 'POST' }); await reload(); }}>Settle</Btn> <Btn ghost action={async () => open(j)}>Open</Btn></p>)}</div>}</>}

    {user.role === 'INSPECTOR' && <><div className="grid"><div className="card"><div className="muted">Available near me</div><div className="stat">{available.length}</div></div><div className="card"><div className="muted">My earnings (pay + bonus)</div><div className="stat">{inr(earnings)}</div></div><div className="card"><div className="muted">My rating</div><div className="stat">★ {user.rating}</div><div className="muted">{user.status}</div></div></div>
    {jobs.filter((j) => j.assignedInspector?.id === user.id).length > 0 && <div className="card" style={{border:'2px solid #34d399'}}><h2>✅ My Assigned Jobs — Start or Continue Inspection</h2>
      {jobs.filter((j) => j.assignedInspector?.id === user.id).map((j) => <p key={j.id}><b>{j.make} {j.model}</b> · {j.regNumber} · <span className="pill">{j.status}</span> <Btn green action={async () => open(j)}>{['ASSIGNED','INSPECTION_IN_PROGRESS'].includes(j.status) ? '🔍 Inspection Start / Continue →' : 'Open →'}</Btn></p>)}
      <p className="muted">Once you accept a job, it is removed from "Jobs Near You" because the assignment is exclusive. It will appear here. Open the job, start the inspection, upload the photos, and submit your manual valuation.</p></div>}
    <div className="card"><h2>📍 Jobs Near You — First to Accept Wins (exclusive)</h2>{available.length === 0 && <p className="muted">No open jobs in your radius right now. New bank jobs appear here LIVE — keep this page open.</p>}
      {available.map((j) => { const me = j.eligibleInspectors?.find((x) => x.id === user.id); return <p key={j.id}><b>{j.make} {j.model} ({j.year})</b> · {j.regNumber} · {me ? `${me.distanceKm} km away` : 'check eligibility'} <Btn action={async () => { await api(`/jobs/${j.id}/accept`, { method: 'POST' }); await reload(); setSelId(j.id); setBanner(`✓ You are assigned to ${j.regNumber}`); }}>✓ Accept Job</Btn> <Btn ghost action={async () => open(j)}>Details</Btn></p>; })}</div></>}

    {user.role === 'LOAN_SEEKER' && <div className="card"><h2>🚗 My Valuation Journey</h2>{jobs.length === 0 && <p className="muted">No valuation linked to your email/phone yet. Ask your bank to create a job with your email (<b>{user.email}</b>) — it will appear here LIVE.</p>}
      {jobs.map((j) => <div key={j.id} style={{ borderBottom: '1px solid #1e2d49', padding: '10px 0' }}><img className="car-thumb" style={{ width: 54, height: 38, verticalAlign: '-13px', marginRight: 9 }} src={carPhotoFor(j)} alt="" loading="lazy" /><b>{j.make} {j.model} ({j.year})</b> · {j.regNumber} <StatusPill s={j.status} />{j.valuation?.finalValuation ? <span> · Final Valuation <b>{inr(j.valuation.finalValuation)}</b></span> : <span className="muted"> · Valuation in progress…</span>}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>{j.valuation?.finalValuation && <Btn ghost action={() => openAuthed(`/api/jobs/${j.id}/report`)}>📄 My Summary Report</Btn>}<Btn ghost action={async () => open(j)}>{j.status === 'REPORT_DELIVERED' && !j.rating ? '⭐ Rate Inspector' : 'Track →'}</Btn></div></div>)}</div>}

    {user.role === 'ADMIN' && <ErrorBoundary><AdminControlCenter jobs={jobs} overview={overview} users={users} inspectors={inspectors} ledger={ledger} liveOn={liveOn} openJob={open} reload={reload} /></ErrorBoundary>}

    {user.role !== 'ADMIN' && <><div className="tabs"><button className={tab === 'jobs' ? 'on' : ''} onClick={() => setTab('jobs')}>All Jobs ({jobs.length})</button>{user.role !== 'LOAN_SEEKER' && <button className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}>Payments & Ledger</button>}<button className={tab === 'notifs' ? 'on' : ''} onClick={() => setTab('notifs')}>Notifications ({notifs.filter((n) => !n.isRead).length})</button>{(user.role === 'ADMIN' || user.role === 'BANK') && <button className={tab === 'analytics' ? 'on' : ''} onClick={() => setTab('analytics')}>🤖 AI Analytics</button>}</div>
    {tab === 'jobs' && <div className="card"><table><thead><tr><th>Vehicle</th><th>Reg</th><th>Status</th><th>Valuation</th><th>Action</th></tr></thead><tbody>{jobs.map((j) => <tr key={j.id}><td><span className="veh-cell"><img className="car-thumb" src={carPhotoFor(j)} alt="" loading="lazy" /><span>{j.make} {j.model} ({j.year})<br /><span className="muted">{fmtDate(j.createdAt)}</span></span></span></td><td>{j.regNumber}</td><td><StatusPill s={j.status} /></td><td>{j.valuation?.finalValuation ? inr(j.valuation.finalValuation) : j.valuation ? `${j.valuation.variancePct}% ${j.valuation.flag}` : '—'}</td><td><Btn ghost action={async () => open(j)}>Open →</Btn></td></tr>)}</tbody></table>{jobs.length === 0 && <p className="muted">No jobs yet.</p>}</div>}
    {tab === 'ledger' && user.role !== 'LOAN_SEEKER' && <div className="card"><table><thead><tr><th>Type</th><th>From → To</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>{ledger.map((l) => <tr key={l.id}><td>{l.type}</td><td>{l.fromParty} → {l.toParty}</td><td>{inr(l.amount)}</td><td>{l.status}</td><td>{fmtDate(l.createdAt)}</td></tr>)}</tbody></table>{ledger.length === 0 && <p className="muted">No transactions yet.</p>}</div>}
    {tab === 'notifs' && <div className="card">{notifs.map((n) => <p key={n.id}><b>{n.title}</b><br /><span className="muted">{n.body} · {fmtDate(n.createdAt)}</span></p>)}{notifs.length === 0 && <p className="muted">No notifications yet.</p>}</div>}
    {tab === 'analytics' && <ErrorBoundary><AnalyticsPanel /></ErrorBoundary>}</>}
    <div id="job-detail">{sel && <ErrorBoundary><JobDetail job={sel} user={user} reload={reload} onClose={() => setSelId(null)} /></ErrorBoundary>}</div>
  </div></div>;
}
function VerifyPage() {
  const { code } = useParams(); const [state, setState] = useState({ loading: true });
  useEffect(() => { fetch(`/api/verify/${encodeURIComponent(code)}`).then(async (r) => { const d = await r.json().catch(() => ({})); setState({ loading: false, ok: r.ok, ...d }); }).catch(() => setState({ loading: false, ok: false })); }, [code]);
  return <div className="wrap"><div className="card login" style={{ textAlign: 'center' }}><h1>Valuation Techno</h1>
    {state.loading && <p className="muted">Checking report authenticity…</p>}
    {!state.loading && state.ok && state.authentic && <><SuccessTick size={84} /><h2 style={{ color: '#34d399' }}>Genuine Report ✅</h2>
      <p><b>{state.vehicle}</b> · {state.regNumber}</p><p>Final Valuation: <b>{inr(state.finalValuation)}</b></p>
      <p className="muted">Status: {state.status} · Flag: {state.flag}{state.deliveredAt ? ` · Delivered: ${fmtDate(state.deliveredAt)}` : ''}</p>
      <p className="muted">{state.message}</p></>}
    {!state.loading && !state.authentic && <><h2 style={{ color: '#fb7185' }}>Not Verified ❌</h2><p className="muted">{state.error || 'This verification code does not match any genuine Valuation Techno report.'}</p></>}
    <p><a href="/">← Open Valuation Techno</a></p></div></div>;
}
function SplashScreen() {
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  const timers = useRef([]);
  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => setPct(Math.min(100, Math.round((Date.now() - t0) / 16))), 30);
    const later = (fn, ms) => { const id = setTimeout(fn, ms); timers.current.push(id); };
    later(() => { clearInterval(iv); setPct(100); }, 1650);
    later(() => setLeaving(true), 1950);
    later(() => setGone(true), 2600);
    return () => { clearInterval(iv); timers.current.forEach(clearTimeout); };
  }, []);
  const skip = () => { setLeaving(true); timers.current.push(setTimeout(() => setGone(true), 380)); };
  if (gone) return null;
  return <div className={`splash${leaving ? ' splash-leave' : ''}`} onClick={skip} role="status" aria-label="Loading Valuation Techno">
    <span className="splash-glow splash-glow-a" /><span className="splash-glow splash-glow-b" />
    <div className="splash-inner">
      <div className="splash-logo">VT</div>
      <h1 className="splash-title">Valuation <span>Techno</span></h1>
      <p className="splash-tag">Smart Valuation. Safer Transactions.</p>
      <div className="splash-car-frame"><img src="/real-car.jpg" alt="Premium valuation car" className="splash-car" /></div>
      <div className="splash-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="splash-meta"><span>AI Valuation Engine Starting…</span><b>{pct}%</b></div>
      <p className="splash-skip">Tap anywhere to skip</p>
    </div>
  </div>;
}
export default function App() {
  useEffect(() => { // scroll-reveal: cards rise in as they enter the screen
    const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('revealed'); io.unobserve(e.target); } }), { threshold: 0.06 });
    const scan = () => document.querySelectorAll('.card:not(.revealed), .adm-panel:not(.revealed)').forEach((el) => { el.classList.add('reveal'); io.observe(el); });
    scan(); const mo = new MutationObserver(scan); mo.observe(document.body, { childList: true, subtree: true });
    const fallback = setTimeout(() => document.querySelectorAll('.reveal').forEach((el) => el.classList.add('revealed')), 2500);
    return () => { io.disconnect(); mo.disconnect(); clearTimeout(fallback); };
  }, []);
  return <><SplashScreen /><CelebrationHost /><Routes><Route path="/" element={token() ? <Navigate to="/dashboard" /> : <Login />} /><Route path="/dashboard" element={<Dashboard />} /><Route path="*" element={<Navigate to="/" />} /></Routes></>; }
