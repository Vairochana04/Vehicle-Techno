import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api, token, sessionUser, setSession, clearSession, inr, fmtDate, openAuthed, blobUrl, logoutApi } from './api.js';
import { carPhotoFor } from './carPhotos.js';
import AiMotion from './components/AiMotion.jsx';
import { FraudGauge, CarTwin, AiScanPanel, MarketChart, LiveMap, AnalyticsPanel, ErrorBoundary, CarShowcase, ValuationDuel, CelebrationHost, SuccessTick, fireCelebration, ChatBox } from './components/Advanced.jsx';
import AdminControlCenter from './components/AdminDashboard.jsx';
import './components/BankDashboard.css';
import './components/InspectorEvidence.css';

const PHASES = ['BROADCAST', 'ASSIGNED', 'INSPECTION_IN_PROGRESS', 'INSPECTION_SUBMITTED', 'AUDIT_REQUIRED', 'REPORT_DELIVERED', 'SETTLED'];
const ROLE_META = {
  BANK: { icon: '', title: 'Bank Officer Dashboard', color: '#0a1424', home: 'Create valuation jobs, track reports & record settlement status' },
  INSPECTOR: { icon: '🔍', title: 'Inspector Dashboard', color: '#0a1424', home: 'Jobs near you, inspections, instant-pay earnings & your rating' },
  LOAN_SEEKER: { icon: '🚗', title: 'My Vehicle Valuation', color: '#0a1424', home: 'Track your valuation, download your summary report & rate your inspector' },
  ADMIN: { icon: '🛡️', title: 'Platform Control Tower', color: '#0a1424', home: 'RED-flag audit queue, inspector governance, money & AI analytics' },
};
function StatusPill({ s, role }) { return <span className="pill">{role === 'BANK' && s === 'SETTLED' ? 'PORTAL SETTLEMENT RECORDED' : s}</span>; }
const BANK_JOB_STAGES = {
  BROADCAST: 'Waiting for inspector',
  ASSIGNED: 'Inspector assigned',
  INSPECTION_IN_PROGRESS: 'Inspection in progress',
  INSPECTION_SUBMITTED: 'Inspection submitted',
  AUDIT_REQUIRED: 'Admin review required',
  REPORT_DELIVERED: 'Full report ready',
  SETTLED: 'Settlement recorded in portal',
};
function BankJobProgressTable({ jobs, open, liveOn }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const matchesFilter = (job, key) => {
    if (key === 'waiting') return job.status === 'BROADCAST';
    if (key === 'inspection') return ['ASSIGNED', 'INSPECTION_IN_PROGRESS', 'INSPECTION_SUBMITTED'].includes(job.status);
    if (key === 'report') return ['REPORT_DELIVERED', 'SETTLED'].includes(job.status);
    if (key === 'audit') return job.status === 'AUDIT_REQUIRED';
    return true;
  };
  const jobFilters = [
    { key: 'all', label: 'All jobs' },
    { key: 'waiting', label: 'Waiting' },
    { key: 'inspection', label: 'Inspection' },
    { key: 'report', label: 'Report ready' },
    { key: 'audit', label: 'Needs audit' },
  ];
  const searchText = query.trim().toLowerCase();
  const visibleJobs = jobs.filter((job) => {
    const matchesSearch = !searchText || [job.loanRef, job.seekerName, job.regNumber, job.make, job.model, job.year, job.assignedInspector?.name].filter(Boolean).join(' ').toLowerCase().includes(searchText);
    return matchesFilter(job, filter) && matchesSearch;
  });

  return <div className="card bank-jobs-card">
    <div className="bank-section-heading">
      <div><h2>Valuation Jobs</h2><p className="muted">Follow inspection progress and open jobs to review reports.</p><p className="bank-job-help">The local preview may include seeded example jobs.</p></div>
      <span className="pill"><span className="live-dot" /> {liveOn ? 'Live updates connected' : 'Reconnecting'}</span>
    </div>
    {jobs.length ? <>
      <div className="bank-job-toolbar">
        <input className="bank-job-search" type="search" aria-label="Search valuation jobs" placeholder="Search loan, borrower or vehicle" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="bank-job-status-filter"><span>Status</span><select aria-label="Filter valuation jobs by status" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {jobFilters.map((item) => <option key={item.key} value={item.key}>{item.label} ({jobs.filter((job) => matchesFilter(job, item.key)).length})</option>)}
        </select></label>
      </div>
      {visibleJobs.length ? <div className="bank-table-wrap"><table className="bank-jobs-table"><thead><tr><th>Loan / borrower</th><th>Vehicle</th><th>Progress</th><th>Final valuation</th><th></th></tr></thead><tbody>{visibleJobs.map((job) => <tr key={job.id}>
        <td><b>{job.loanRef || '—'}</b><br /><span className="muted">{job.seekerName || '—'}</span></td><td><b>{job.regNumber}</b><br /><span className="muted">{job.make} {job.model} ({job.year})</span></td><td><span className={`pill ${job.status === 'AUDIT_REQUIRED' ? 'bank-audit-pill' : ''}`}>{BANK_JOB_STAGES[job.status] || job.status.replaceAll('_', ' ')}</span><br /><span className="muted">{job.assignedInspector?.name || 'Waiting for inspector'}</span>{job.loanDecision && <><br /><span className="muted">Loan decision: {job.loanDecision.decision}</span></>}</td><td>{job.valuation?.finalValuation ? inr(job.valuation.finalValuation) : job.status === 'AUDIT_REQUIRED' ? 'Admin review pending' : 'Not ready'}</td><td><Btn ghost action={async () => open(job)}>Open</Btn></td>
      </tr>)}</tbody></table></div> : <div className="bank-empty-state bank-filter-empty"><b>No matching jobs</b><span>Try another status filter or search term.</span><button type="button" className="bank-clear-filters" onClick={() => { setFilter('all'); setQuery(''); }}>Clear filters</button></div>}
    </> : <div className="bank-empty-state"><b>No valuation jobs yet</b><span>Create a valuation job above to get started.</span></div>}
  </div>;
}
function BankSettlementQueue({ toSettle, open, recordSettlement }) {
  return <div className="card bank-settlement-card">
    <div className="bank-section-heading"><div><h2>Settlement queue</h2><p className="muted">Delivered valuation reports ready for portal fee recording.</p></div><span className="pill">{toSettle.length} ready</span></div>
    <details className="bank-settlement-details">
      <summary>{toSettle.length ? `View ${toSettle.length} report${toSettle.length === 1 ? '' : 's'} ready for recording` : 'No reports ready yet'}</summary>
      {toSettle.length ? <div className="bank-settlement-list">{toSettle.map((job) => <div className="bank-settlement-row" key={job.id}>
        <div><b>{job.regNumber}</b><span>Final valuation: <b>{job.valuation?.finalValuation ? inr(job.valuation.finalValuation) : '—'}</b></span><small>Valuation service fee: {inr(job.valuationFee)} · {job.loanRef || 'No loan reference'}</small></div>
        <div className="bank-settlement-actions"><Btn ghost action={async () => open(job)}>Open details</Btn><Btn green action={async () => recordSettlement(job)}>Record settlement</Btn></div>
      </div>)}</div> : <p className="muted bank-settlement-empty">Once a valuation report is delivered, the job will appear here.</p>}
    </details>
    <p className="bank-job-help">Portal-only valuation fee record; it does not approve or settle the loan or initiate/verify a transfer.</p>
  </div>;
}
function Stepper({ status, role }) { const idx = PHASES.indexOf(status); return <div className="stepper">{PHASES.map((p, i) => <span key={p} className={`step ${i <= idx ? 'on' : ''}`}>{role === 'BANK' && p === 'SETTLED' ? 'PORTAL SETTLEMENT RECORDED' : p.replaceAll('_', ' ')}</span>)}</div>; }

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
  const showDemoLogins = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_LOGINS === 'true';
  const doLogin = async (email, password) => { const d = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); setSession(d.token, d.user); nav('/dashboard'); };
  const demos = showDemoLogins ? [['🏦 Bank', 'bank@valuation.techno', 'Bank@123', 'Creates jobs, reviews reports & records portal fee status'], ['🔍 Inspector Ravi ★4.6', 'inspector@valuation.techno', 'Inspector@123', 'Accepts inspection jobs & submits evidence'], ['🚗 Loan Seeker', 'seeker@valuation.techno', 'Seeker@123', 'Views valuation summary & rates inspector'], ['🛡️ Platform Admin', 'admin@valuation.techno', 'Admin@123', 'Reviews audit flags & manages platform controls']] : [];
  return <div className="wrap login-page"><div className="card login"><h1>Valuation Techno</h1><p className="muted">Smart Valuation. Safer Transactions — vehicle valuation portal for Bank, Inspector, Loan Seeker & Platform Admin. <b>Each login opens a different dashboard.</b></p><CarShowcase />
    {err && <div className="err">{err}</div>}{msg && <div className="ok">{msg}</div>}
    <div className="tabs"><button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Login</button><button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Register</button>{showDemoLogins && <button className={mode === 'otp' ? 'on' : ''} onClick={() => setMode('otp')}>OTP Login</button>}</div>
    {mode === 'login' && <><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@bank.com" /><label>Password</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <Btn action={() => doLogin(form.email, form.password)}>Login →</Btn>
      {showDemoLogins && <><p className="muted">One-click demo logins (each is a different dashboard):</p><div className="demo">{demos.map(([l, e, p, desc]) => <Btn key={e} ghost action={() => doLogin(e, p)}>{l} — {desc}</Btn>)}</div></>}</>}
    {mode === 'register' && <><label>Full name</label><input value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} /><label>Email</label><input value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} /><label>Phone</label><input value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} placeholder="+91..." /><label>Role</label><select value={reg.role} onChange={(e) => setReg({ ...reg, role: e.target.value })}>{showDemoLogins && <><option value="BANK">Bank</option><option value="INSPECTOR">Inspector</option></>}<option value="LOAN_SEEKER">Loan Seeker</option></select><label>Password (min 6 chars)</label><input type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} />
      <Btn action={async () => { const d = await api('/auth/register', { method: 'POST', body: JSON.stringify(reg) }); setSession(d.token, d.user); nav('/dashboard'); }}>Create account →</Btn></>}
    {mode === 'otp' && showDemoLogins && <><label>Phone (demo: +919000000003 = Inspector Ravi)</label><input id="otp-phone" placeholder="+919000000003" />
      <Btn ghost action={async () => { const d = await api('/auth/otp/request', { method: 'POST', body: JSON.stringify({ phone: document.getElementById('otp-phone').value }) }); setOtp(d.demoOtp); setMsg(`OTP sent to your phone${d.demoOtp ? ` (demo OTP: ${d.demoOtp})` : ''}`); }}>Send OTP</Btn>
      <label>OTP</label><input id="otp-code" placeholder="6-digit OTP" />
      <Btn action={async () => { const d = await api('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ phone: document.getElementById('otp-phone').value, code: document.getElementById('otp-code').value }) }); setSession(d.token, d.user); nav('/dashboard'); }}>Verify & Login →</Btn></>}
  </div></div>;
}
const INSPECTOR_CONDITION_AREAS = [['engine', 'Engine'], ['body', 'Body / exterior'], ['tires', 'Tyres'], ['interior', 'Interior']];
const INSPECTOR_DAMAGE_TYPES = [['dent', 'Dent'], ['scratch', 'Scratch'], ['rust', 'Rust'], ['crack', 'Crack'], ['tire', 'Tyre damage']];
const INSPECTOR_PHOTO_CHECKLIST = [
  { category: 'FRONT', label: 'Front exterior', required: true },
  { category: 'REAR', label: 'Rear exterior', required: true },
  { category: 'LEFT', label: 'Left-side exterior', required: true },
  { category: 'RIGHT', label: 'Right-side exterior', required: true },
  { category: 'ENGINE', label: 'Engine bay', required: true },
  { category: 'TIRE', label: 'Tyres and wheels', required: true },
  { category: 'ODOMETER', label: 'Odometer', required: true },
  { category: 'DAMAGE', label: 'Damage close-up (if applicable)', required: false },
];
const emptyInspectorPhoto = (category) => ({ category, lat: null, lng: null, capturedAt: null, imageHash: null, filename: null, originalName: null });

function InspectionForm({ job, reload }) {
  const docTypes = [['RC', 'Registration Certificate (RC)'], ['INSURANCE', 'Insurance policy'], ['POLLUTION', 'Pollution / PUC certificate'], ['SERVICE_RECORD', 'Service records']];
  const draftKey = `vt_draft_${job.id}`;
  const draft = (() => { try { return JSON.parse(localStorage.getItem(draftKey)); } catch { return null; } })();
  const [f, setF] = useState(draft?.f || { odometerReading: '', manualValuation: '', manualRepairEstimate: '', notes: '' });
  const [condition, setCondition] = useState(draft?.condition || Object.fromEntries(INSPECTOR_CONDITION_AREAS.map(([key]) => [key, ''])));
  const [damages, setDamages] = useState(Array.isArray(draft?.damages) ? draft.damages : []);
  const [images, setImages] = useState(() => {
    const saved = (Array.isArray(draft?.images) ? draft.images : []).filter((image) => image?.filename && image?.imageHash);
    const requiredSlots = INSPECTOR_PHOTO_CHECKLIST.map(({ category }) => saved.find((image) => image.category === category) || emptyInspectorPhoto(category));
    const extraDamagePhotos = saved.filter((image) => image.category === 'DAMAGE').slice(1);
    return [...requiredSlots, ...extraDamagePhotos];
  });
  const [documents, setDocuments] = useState(() => (Array.isArray(draft?.documents) ? draft.documents : []).filter((doc) => doc?.filename));
  const [uploadingDocument, setUploadingDocument] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(-1);
  const [submitting, setSubmitting] = useState(false);
  const [gps, setGps] = useState(null);
  const [err, setErr] = useState(''); const [done, setDone] = useState('');
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify({ f, condition, damages, images, documents })); } catch { /* non-fatal */ } }, [f, condition, damages, images, documents]);

  const readGps = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This browser does not support GPS location.'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
  const locationFromPosition = (position) => ({
    lat: Number(position.coords.latitude.toFixed(6)),
    lng: Number(position.coords.longitude.toFixed(6)),
    recordedAt: new Date().toISOString(),
    recordedMs: Date.now(),
  });
  const captureGps = async () => {
    setErr('');
    try {
      const position = await readGps();
      const location = locationFromPosition(position);
      setGps(location);
      setDone(`Live GPS captured: ${location.lat}, ${location.lng}. It will be attached to the next photos you upload.`);
    } catch (error) {
      setGps(null);
      setErr(error.message || 'GPS permission was not available. Photos can still upload without a location tag.');
    }
  };
  const uploadPhoto = async (e, idx) => {
    const input = e.currentTarget; const file = input.files?.[0]; if (!file) return;
    setErr(''); setDone('');
    if (!file.type.startsWith('image/')) { setErr('Please select an image file for this photo slot.'); input.value = ''; return; }
    if (file.size > 10 * 1024 * 1024) { setErr('Each photo must be 10 MB or smaller.'); input.value = ''; return; }
    setUploadingPhoto(idx);
    try {
      let location = gps && Date.now() - gps.recordedMs < 5 * 60 * 1000 ? gps : null;
      if (!location) {
        try { location = locationFromPosition(await readGps()); setGps(location); } catch { location = null; }
      }
      const fileTime = Number(file.lastModified);
      const capturedAt = new Date(Number.isFinite(fileTime) && fileTime > 0 ? fileTime : Date.now()).toISOString();
      const fd = new FormData(); fd.append('file', file); fd.append('category', images[idx].category); fd.append('capturedAt', capturedAt);
      if (location) { fd.append('lat', String(location.lat)); fd.append('lng', String(location.lng)); }
      const sessionToken = token();
      const res = await fetch('/api/upload', { method: 'POST', headers: sessionToken ? { Authorization: `Bearer ${sessionToken}`, 'X-Auth-Token': sessionToken } : {}, body: fd });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || 'Photo upload failed.');
      setImages((current) => current.map((image, i) => i === idx ? {
        ...image, imageHash: result.imageHash, filename: result.filename, originalName: result.originalName,
        lat: result.lat ?? null, lng: result.lng ?? null, capturedAt: result.capturedAt || capturedAt,
      } : image));
      const photo = INSPECTOR_PHOTO_CHECKLIST.find((item) => item.category === images[idx].category);
      setDone(`${photo?.label || 'Photo'} uploaded. ${result.lat != null && result.lng != null ? 'GPS and time recorded.' : 'Time recorded; GPS was unavailable.'}`);
    } catch (error) {
      setErr(error.message || 'Photo upload failed.');
    } finally {
      setUploadingPhoto(-1); input.value = '';
    }
  };
  const uploadDocument = async (e, type) => {
    const input = e.currentTarget; const files = Array.from(input.files || []); if (!files.length) return;
    setErr(''); setUploadingDocument(type);
    try {
      const uploaded = [];
      for (const file of files) {
        const fd = new FormData(); fd.append('file', file); fd.append('category', type);
        const sessionToken = token();
        const res = await fetch('/api/upload', { method: 'POST', headers: sessionToken ? { Authorization: `Bearer ${sessionToken}`, 'X-Auth-Token': sessionToken } : {}, body: fd });
        const result = await res.json().catch(() => ({})); if (!res.ok) throw new Error(result.error || `Could not upload ${file.name}`);
        uploaded.push({ type, filename: result.filename, originalName: result.originalName });
      }
      setDocuments((current) => type === 'SERVICE_RECORD' ? [...current, ...uploaded] : [...current.filter((doc) => doc.type !== type), ...uploaded.slice(-1)]);
      setDone(`Uploaded ${uploaded.map((doc) => doc.originalName).join(', ')} ✓`);
    } catch (error) { setErr(error.message || 'Document upload failed'); }
    finally { setUploadingDocument(''); input.value = ''; }
  };
  const uploadedPhotos = images.filter((image) => image.filename && image.imageHash);
  const requiredPhotoTotal = INSPECTOR_PHOTO_CHECKLIST.filter((item) => item.required).length;
  const uploadedRequiredPhotoCount = INSPECTOR_PHOTO_CHECKLIST.filter((item) => item.required && uploadedPhotos.some((image) => image.category === item.category)).length;
  const uploadedDocumentTypes = docTypes.filter(([type]) => documents.some((doc) => doc.type === type)).length;

  return <div style={{ marginTop: 14 }}><h3>🔍 On-Site Inspection (Phase 2)</h3>{err && <div className="err">{err}</div>}{done && <div className="ok">{done}</div>}
    <div className="row"><div><label>Actual odometer reading (km) *</label><input type="number" min="0" value={f.odometerReading} onChange={(e) => setF({ ...f, odometerReading: e.target.value })} placeholder={job.expectedOdometer ? `Check against expected ${job.expectedOdometer} km` : 'Enter the reading from the vehicle'} /></div><div><label>Your manual valuation (₹) *</label><input type="number" min="1" value={f.manualValuation} onChange={(e) => setF({ ...f, manualValuation: e.target.value })} placeholder="e.g. 735000" /></div></div>
    <div className="card inspector-evidence-card"><div className="inspector-evidence-heading"><div><h4>Condition ratings</h4><p className="muted">Rate each area from 1 (poor) to 5 (excellent) based on what you inspect.</p></div></div>
      <div className="inspector-condition-grid">{INSPECTOR_CONDITION_AREAS.map(([key, label]) => <label className="inspector-condition-field" key={key}>{label} (1–5)<select value={condition[key] ?? ''} onChange={(e) => setCondition((current) => ({ ...current, [key]: e.target.value }))}><option value="">Choose rating</option>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} — {['', 'Poor', 'Below average', 'Fair', 'Good', 'Excellent'][score]}</option>)}</select></label>)}</div>
    </div>
    <div className="row"><div><label>Manual repair estimate (₹)</label><input type="number" min="0" value={f.manualRepairEstimate} onChange={(e) => setF({ ...f, manualRepairEstimate: e.target.value })} placeholder="Enter estimate if damage is found" /></div><div><label>Inspection notes</label><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Add notes from the on-site inspection" /></div></div>

    <div className="card inspector-evidence-card">
      <div className="inspector-evidence-heading"><div><h4>Photo checklist</h4><p className="muted">Use the camera or choose a real photo for each required view. Damage photos are needed when you record damage.</p></div><span className="pill">{uploadedRequiredPhotoCount}/{requiredPhotoTotal} required · {Math.max(0, uploadedPhotos.length - uploadedRequiredPhotoCount)} extra</span></div>
      <div className="inspector-evidence-actions"><Btn ghost action={captureGps}>📍 Capture live GPS</Btn><span className="muted">{gps ? `GPS ready: ${gps.lat}, ${gps.lng} · ${fmtDate(gps.recordedAt)}` : 'GPS is attached when available; the vehicle’s job location is not substituted.'}</span></div>
      {images.map((image, idx) => {
        const checklistItem = INSPECTOR_PHOTO_CHECKLIST.find((item) => item.category === image.category);
        const damageNumber = image.category === 'DAMAGE' ? images.slice(0, idx + 1).filter((item) => item.category === 'DAMAGE').length : 0;
        const label = image.category === 'DAMAGE' && damageNumber > 1 ? `Damage close-up ${damageNumber}` : checklistItem?.label || image.category;
        const hasGps = image.lat != null && image.lng != null;
        return <div key={`${image.category}-${idx}`} className={`inspector-evidence-row ${image.filename ? 'is-uploaded' : ''}`}>
          <div><div className="inspector-evidence-label">{label} <span className="pill">{checklistItem?.required ? 'Required' : 'If applicable'}</span></div>
            <div className="inspector-evidence-meta"><span className={`pill ${image.filename ? 'inspector-evidence-pill-uploaded' : ''}`}>{image.filename ? 'Uploaded' : 'Not uploaded'}</span>
              {image.filename && <><span className={`pill ${hasGps ? 'inspector-evidence-pill-uploaded' : 'inspector-evidence-pill-missing'}`}>{hasGps ? 'GPS recorded' : 'GPS missing'}</span><span className="muted">{image.originalName} · Device time {fmtDate(image.capturedAt)}{hasGps ? ` · ${image.lat}, ${image.lng}` : ''}</span></>}
            </div>
          </div>
          <div><input aria-label={`Capture or upload ${label}`} type="file" accept="image/*" capture="environment" disabled={uploadingPhoto !== -1} onChange={(e) => uploadPhoto(e, idx)} />{uploadingPhoto === idx && <span className="muted">Uploading photo…</span>}</div>
        </div>;
      })}
      <div className="inspector-evidence-actions"><Btn ghost action={async () => setImages((current) => [...current, emptyInspectorPhoto('DAMAGE')])}>+ Add another damage photo</Btn><span className="muted">GPS may be unavailable if browser permission is denied; missing GPS stays marked missing.</span></div>
      <p className="inspector-evidence-note">Uploaded images are hashed from the actual file. The timestamp comes from the device file time and is not independently verified in this preview.</p>
    </div>

    <div className="card inspector-evidence-card"><div className="inspector-evidence-heading"><div><h4>Vehicle document checklist</h4><p className="muted">Upload available RC, insurance, PUC and service-record files (PDF or image).</p></div><span className="pill">{uploadedDocumentTypes}/{docTypes.length} types attached</span></div>
      {docTypes.map(([type, label]) => {
        const attached = documents.filter((doc) => doc.type === type);
        return <div key={type} className="inspector-document-row"><div><b>{label}</b><div className="muted">{attached.map((doc) => doc.originalName).join(', ') || 'No file attached'}</div></div>
          <div className="inspector-document-status"><span className={`pill ${attached.length ? 'inspector-evidence-pill-uploaded' : 'inspector-evidence-pill-missing'}`}>{attached.length ? `Attached${attached.length > 1 ? ` (${attached.length})` : ''}` : 'Not provided'}</span><input aria-label={`Upload ${label}`} type="file" accept="application/pdf,image/*,.pdf" multiple={type === 'SERVICE_RECORD'} disabled={Boolean(uploadingDocument)} onChange={(e) => uploadDocument(e, type)} />{uploadingDocument === type && <span className="muted">Uploading…</span>}</div>
        </div>;
      })}
      <p className="inspector-evidence-note">Attach the documents available for this vehicle. They stay private to authorized job participants; document contents are not read by live AI in this preview.</p>
    </div>
    {(uploadingPhoto !== -1 || uploadingDocument) && <div className="inspector-motion-wrap"><AiMotion label="Uploading inspection evidence" detail="Progress visual only · no live AI analysis" /></div>}

    <div className="inspector-damage-section"><div className="inspector-evidence-heading"><div><h4>Observed damage</h4><p className="muted">Record each finding with a description and your repair estimate. Add only damage you observe.</p></div></div>
      {damages.length === 0 && <p className="muted">No damage recorded. Add an item only if you find damage.</p>}
      {damages.map((damage, index) => <div className="inspector-damage-entry" key={index}><div className="inspector-damage-grid">
        <label>Part<input value={damage.part || ''} onChange={(e) => setDamages((current) => current.map((item, i) => i === index ? { ...item, part: e.target.value } : item))} placeholder="e.g. front bumper" /></label>
        <label>Type<select value={String(damage.type || 'dent').toLowerCase()} onChange={(e) => setDamages((current) => current.map((item, i) => i === index ? { ...item, type: e.target.value } : item))}>{INSPECTOR_DAMAGE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Severity<select value={damage.severity || 'Medium'} onChange={(e) => setDamages((current) => current.map((item, i) => i === index ? { ...item, severity: e.target.value } : item))}><option>Small</option><option>Medium</option><option>Large</option></select></label>
        <label className="inspector-damage-description">Description<input value={damage.description || ''} onChange={(e) => setDamages((current) => current.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} placeholder="Describe what you observed" /></label>
        <label>Repair estimate (₹)<input type="number" min="0" value={damage.repairEstimate ?? ''} onChange={(e) => setDamages((current) => current.map((item, i) => i === index ? { ...item, repairEstimate: e.target.value } : item))} placeholder="Enter estimated cost" /></label>
      </div><Btn ghost action={async () => setDamages((current) => current.filter((_, i) => i !== index))}>Remove damage</Btn></div>)}
      <Btn ghost action={async () => setDamages((current) => [...current, { part: '', type: 'dent', severity: 'Medium', description: '', repairEstimate: '' }])}>+ Add damage</Btn>
    </div>
    {submitting && <div className="inspector-motion-wrap"><AiMotion label="Submitting inspection" detail="Progress visual only · no live AI analysis" /></div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Btn action={async () => {
      const odometerReading = Number(f.odometerReading); const manualValuation = Number(f.manualValuation);
      if (f.odometerReading === '' || !Number.isInteger(odometerReading) || odometerReading < 0) throw new Error('Enter the actual odometer reading from the vehicle.');
      if (!Number.isFinite(manualValuation) || manualValuation <= 0) throw new Error('Enter your manual valuation first.');
      const missingCondition = INSPECTOR_CONDITION_AREAS.filter(([key]) => ![1, 2, 3, 4, 5].includes(Number(condition[key])));
      if (missingCondition.length) throw new Error(`Rate each condition area first: ${missingCondition.map(([, label]) => label).join(', ')}.`);
      const conditionRatings = Object.fromEntries(INSPECTOR_CONDITION_AREAS.map(([key]) => [key, Number(condition[key])]));
      const missingPhotos = INSPECTOR_PHOTO_CHECKLIST.filter((item) => item.required && !uploadedPhotos.some((image) => image.category === item.category));
      if (missingPhotos.length) throw new Error(`Complete the photo checklist first: ${missingPhotos.map((item) => item.label).join(', ')}.`);
      const rawDamageEntries = damages.filter((damage) => String(damage.part || '').trim());
      if (rawDamageEntries.some((damage) => !String(damage.description || '').trim() || damage.repairEstimate === '' || damage.repairEstimate == null || !Number.isFinite(Number(damage.repairEstimate)))) throw new Error('Add a description and repair estimate for each recorded damage.');
      const damageEntries = rawDamageEntries.map((damage) => ({ ...damage, part: String(damage.part).trim(), type: String(damage.type || 'dent').toLowerCase(), description: String(damage.description).trim(), repairEstimate: Number(damage.repairEstimate) }));
      if (damageEntries.length && !uploadedPhotos.some((image) => image.category === 'DAMAGE')) throw new Error('Upload a damage close-up for the damage you recorded, or remove that damage entry.');
      const repairEstimate = f.manualRepairEstimate === '' ? undefined : Number(f.manualRepairEstimate);
      const payload = { odometerReading, manualValuation, ...(repairEstimate === undefined ? {} : { manualRepairEstimate: repairEstimate }), notes: f.notes, condition: conditionRatings, damages: damageEntries, images: uploadedPhotos, documents };
      setSubmitting(true);
      try {
        await api(`/jobs/${job.id}/inspection`, { method: 'POST', body: JSON.stringify(payload) });
        localStorage.removeItem(draftKey); await reload();
      } finally { setSubmitting(false); }
    }}>Submit Inspection →</Btn></div>
    <p className="muted">The preview attaches only photos you uploaded, then runs simulated AI/fraud analysis and compares it with your manual valuation. Payment rows are portal records only; they do not verify a real transfer. Drafts save in this browser.</p></div>;
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

function BankReportSummary({ job, valuation }) {
  const reportReady = ['REPORT_DELIVERED', 'SETTLED'].includes(job.status);
  const isRed = valuation.flag === 'RED' || Number(valuation.variancePct) > 5;
  const reviewState = job.status === 'AUDIT_REQUIRED' ? 'Admin audit needed' : reportReady ? 'Report ready' : 'Review pending';
  return <section className="bank-report-summary">
    <div className="bank-report-summary-header">
      <div><span className="bank-report-eyebrow">REPORT REVIEW</span><h3>Valuation comparison</h3></div>
      <div className="bank-report-review-meta"><AiMotion label="AI comparison" detail="Simulated · not live" /><span className={`bank-review-state${job.status === 'AUDIT_REQUIRED' ? ' needs-audit' : ''}`}>{reviewState}</span></div>
    </div>
    <div className="bank-report-metrics">
      <div className="bank-report-metric"><span>Inspector valuation</span><strong>{inr(valuation.manualValuation)}</strong></div>
      <div className="bank-report-metric"><span>AI valuation</span><strong>{inr(valuation.aiValuation)}</strong></div>
      <div className="bank-report-metric"><span>Final valuation</span><strong>{inr(valuation.finalValuation)}</strong></div>
      <div className="bank-report-metric"><span>Variance</span><strong className={isRed ? 'is-red' : 'is-green'}>{valuation.variancePct}% · {isRed ? 'RED' : 'GREEN'}</strong></div>
    </div>
    {job.analysis && <div className="bank-report-risk-row">
      <div><span>Damage estimate</span><strong>{inr(job.analysis.damage?.costBreakdown?.totalDamageCost)}</strong></div>
      <div><span>Fraud risk</span><strong>{job.analysis.fraud?.riskLevel || '—'} · {job.analysis.fraud?.fraudScore ?? '—'}/100</strong></div>
    </div>}
    <p className="bank-report-note">{isRed ? (job.status === 'AUDIT_REQUIRED' ? 'Variance is over 5%; Admin audit is pending. Settlement recording is not available yet.' : 'Variance is over 5%; this report has passed the required Admin audit.') : 'Green is 5% variance or less; Red is over 5% and requires Admin audit.'} This valuation is an assessment only—the Bank makes the loan decision separately.</p>
    {reportReady && <div className="bank-report-actions">
      <Btn ghost action={() => openAuthed(`/api/jobs/${job.id}/report`)}>View full report</Btn>
      <Btn ghost action={() => openAuthed(`/api/jobs/${job.id}/report.pdf`)}>Download PDF</Btn>
    </div>}
    {reportReady && job.verifyCode && <details className="bank-report-verify"><summary>QR verification</summary><div className="bank-report-verify-content"><QrImage jobId={job.id} /><div><b>Verification code: {job.verifyCode}</b><p className="muted">Use the public verification page to check this report.</p><a href={`/verify/${job.verifyCode}`} target="_blank" rel="noreferrer">Open verification page</a></div></div></details>}
  </section>;
}

function BankLoanDecisionPanel({ job, reload }) {
  const [note, setNote] = useState('');
  const decision = job.loanDecision;
  const history = job.loanDecisionHistory || [];
  const recordDecision = async (nextDecision) => {
    await api(`/jobs/${job.id}/loan-decision`, { method: 'POST', body: JSON.stringify({ decision: nextDecision, note: note.trim() || undefined }) });
    setNote('');
    await reload();
  };
  return <section className="card bank-loan-decision">
    <div className="bank-section-heading"><div><h3>Bank loan decision</h3><p className="muted">Separate from the vehicle valuation. The Bank makes this final decision.</p></div>{decision && <span className={`pill ${decision.decision === 'APPROVED' ? 'inspector-evidence-pill-uploaded' : 'inspector-evidence-pill-missing'}`}>{decision.decision}</span>}</div>
    {decision ? <p><b>Latest decision:</b> {decision.decision} · {fmtDate(decision.decidedAt)}{decision.note ? <><br /><span className="muted">Note: {decision.note}</span></> : null}</p> : <p className="muted">No loan decision recorded yet. Review the valuation report, then record the Bank’s decision.</p>}
    {history.length > 1 && <details><summary>Decision history ({history.length} entries)</summary>{history.map((entry) => <p key={entry.id}><b>{entry.decision}</b> · {fmtDate(entry.decidedAt)}{entry.note ? ` · ${entry.note}` : ''}</p>)}</details>}
    <label>Decision note{decision ? ' (required when changing the saved decision)' : ' (optional)'}</label><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision ? 'Explain why the decision is changing' : 'Add an optional note'} />
    <div className="bank-loan-decision-actions">{decision?.decision !== 'APPROVED' && <Btn green action={async () => recordDecision('APPROVED')}>Record loan approved</Btn>}{decision?.decision !== 'DECLINED' && <Btn danger action={async () => recordDecision('DECLINED')}>Record loan declined</Btn>}</div>
    <p className="bank-job-help">This records the Bank’s decision in the portal only; it does not disburse the loan or change the valuation.</p>
  </section>;
}

function JobDetail({ job, user, reload, onClose }) {
  if (!job) return null; const v = job.valuation;
  return <div className="card" style={{ border: '2px solid #38bdf8' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><h2>{job.make} {job.model} {job.variant || ''} ({job.year}) · {job.regNumber}</h2><Btn ghost action={async () => onClose()}>✕ Close</Btn></div>{user.role !== 'BANK' && <img className="job-hero-img" src={carPhotoFor(job)} alt={`${job.make} ${job.model}`} />}<Stepper status={job.status} role={user.role} />
    <p><StatusPill s={job.status} role={user.role} /> <span className="muted">Loan: {job.loanRef || '—'} · Seeker: {job.seekerName} · Fee: {inr(job.valuationFee)} · Mode: {job.allocationMode} · Radius: {job.broadcastRadiusKm} km</span></p>
    {job.verification && <details open><summary><b>{user.role === 'BANK' ? 'Preview-only vehicle check simulation' : 'Vehicle Verification (VAHAN / IIB)'}</b></summary>{user.role === 'BANK' && <p className="muted">These displayed check results are simulated preview data. Live VAHAN/IIB provider access is not connected; do not rely on them for lending or compliance decisions.</p>}<table><tbody>{job.verification.checks?.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.status}</td><td>{c.detail}</td></tr>)}</tbody></table><p className="muted">Accidents: {job.verification.history?.accidentCount} · Claims: {job.verification.history?.claimCount} · Owners: {job.verification.ownership?.ownersCount} · Insurance valid: {job.verification.insurance?.valid ? 'Yes' : 'No'}</p></details>}
    {job.assignedInspector && <p>Inspector: <b>{job.assignedInspector.name}</b> ★ {job.assignedInspector.rating} ({job.assignedInspector.status})</p>}
    {!job.assignedInspector && job.eligibleInspectors?.length > 0 && <p className="muted">Eligible inspectors in radius: {job.eligibleInspectors.map((i) => `${i.name} ★${i.rating} (${i.distanceKm} km)`).join(' · ')}</p>}
    {user.role === 'BANK' && v && <><BankReportSummary job={job} valuation={v} />{['REPORT_DELIVERED', 'SETTLED'].includes(job.status) && <BankLoanDecisionPanel job={job} reload={reload} />}</>}
    {v && user.role !== 'BANK' && <div><h3>Dual Valuation</h3><table><tbody><tr><td>Market (DeepSearch)</td><td>{inr(v.marketValue)}</td><td>AI Valuation</td><td>{inr(v.aiValuation)}</td></tr><tr><td>Manual Valuation</td><td>{inr(v.manualValuation)}</td><td>Variance</td><td>{v.variancePct}% <span className={`flag ${v.flag}`}>{v.flag} FLAG</span></td></tr><tr><td>Final Valuation</td><td><b>{inr(v.finalValuation)}</b></td><td>Status</td><td>{v.status}</td></tr></tbody></table><p className="muted">{(v.varianceReasons || []).join('; ')}</p>{user.role !== 'LOAN_SEEKER' && v.aiValuation != null && <ValuationDuel v={v} />}</div>}
    {job.analysis && user.role !== 'LOAN_SEEKER' && (user.role === 'BANK' ? <section className="bank-ai-detail"><h3>AI Damage & Fraud (killfake.ai)</h3><p>Damage total: {inr(job.analysis.damage.costBreakdown.totalDamageCost)} · Tire wear {job.analysis.damage.tireWearPct}% · Fraud: <b>{job.analysis.fraud.riskLevel} ({job.analysis.fraud.fraudScore}/100)</b></p><table><tbody>{job.analysis.fraud.checks.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.status}</td><td>{c.detail}</td></tr>)}</tbody></table></section> : <details open><summary><b>AI Damage & Fraud (killfake.ai)</b></summary><p>Damage total: {inr(job.analysis.damage.costBreakdown.totalDamageCost)} · Tire wear {job.analysis.damage.tireWearPct}% · Fraud: <b>{job.analysis.fraud.riskLevel} ({job.analysis.fraud.fraudScore}/100)</b></p><table><tbody>{job.analysis.fraud.checks.map((c) => <tr key={c.name}><td>{c.name}</td><td>{c.status}</td><td>{c.detail}</td></tr>)}</tbody></table></details>)}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
      {user.role === 'INSPECTOR' && job.status === 'BROADCAST' && <Btn action={async () => { await api(`/jobs/${job.id}/accept`, { method: 'POST' }); await reload(); }}>✓ Accept Job (exclusive)</Btn>}
      {user.role === 'INSPECTOR' && job.status === 'ASSIGNED' && <Btn action={async () => { await api(`/jobs/${job.id}/start`, { method: 'POST' }); await reload(); }}>▶ Start Inspection</Btn>}
      {user.role !== 'BANK' && v?.finalValuation && <Btn ghost action={() => openAuthed(`/api/jobs/${job.id}/report`)}>📄 View {user.role === 'LOAN_SEEKER' ? 'Summary' : 'Full'} Report</Btn>}
      {user.role !== 'BANK' && v?.finalValuation && <Btn ghost action={() => openAuthed(`/api/jobs/${job.id}/report.pdf`)}>⬇ Download PDF</Btn>}
      {user.role === 'ADMIN' && job.status === 'REPORT_DELIVERED' && <Btn green action={async () => { await api(`/jobs/${job.id}/settle`, { method: 'POST' }); await reload(); }}>💰 Settle Payment</Btn>}
    </div>
    {user.role === 'INSPECTOR' && job.assignedInspector?.id === user.id && ['ASSIGNED', 'INSPECTION_IN_PROGRESS'].includes(job.status) && <LiveShare job={job} />}
    {user.role === 'INSPECTOR' && ['ASSIGNED', 'INSPECTION_IN_PROGRESS'].includes(job.status) && <InspectionForm job={job} reload={reload} />}
    {job.verifyCode && user.role !== 'BANK' && <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}><QrImage jobId={job.id} /><p style={{ margin: 0 }}>🔐 <b>Report Verification</b><br />Verification Code: <b>{job.verifyCode}</b><br /><span className="muted">Scan this QR code (it is also printed at the top of the full report & PDF), or</span> <a href={`/verify/${job.verifyCode}`} target="_blank" rel="noreferrer">open the public verification page</a></p></div>}
    {user.role === 'BANK' ? <details className="bank-detail-extra" open><summary>Job messages</summary><ChatBox jobId={job.id} me={user} /></details> : ['INSPECTOR', 'ADMIN'].includes(user.role) && <ChatBox jobId={job.id} me={user} />}
    {user.role === 'ADMIN' && job.status === 'AUDIT_REQUIRED' && <AuditBox job={job} reload={reload} />}
    {user.role === 'LOAN_SEEKER' && job.status === 'REPORT_DELIVERED' && !job.rating && <RateBox job={job} reload={reload} />}
    {user.role === 'BANK' && ['REPORT_DELIVERED', 'SETTLED'].includes(job.status) && !job.bankFeedback && <BankFeedbackBox job={job} reload={reload} />}
    {job.rating && <p className="ok">Rating: Seeker {job.rating.seekerScore}/5 · Platform {job.rating.platformScore}/5 · <b>Composite {job.rating.composite}/5</b> (0.4×Seeker + 0.6×Platform)</p>}
    {job.bankFeedback && <p className="ok">Bank feedback: <b>{job.bankFeedback.avgScore}/5</b></p>}
    {job.analysis && user.role !== 'LOAN_SEEKER' && user.role !== 'BANK' && <div className="card" style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}><FraudGauge score={job.analysis.fraud.fraudScore} risk={job.analysis.fraud.riskLevel} /><CarTwin detections={job.analysis.damage.detections} /><div style={{ flex: 1, minWidth: 260 }}><AiScanPanel analysis={job.analysis} /></div></div>}
    {user.role === 'BANK' ? <details className="bank-detail-extra" open><summary>Location and market context</summary><div className="bank-context-grid"><LiveMap job={job} /><MarketChart make={job.make} model={job.model} /></div></details> : user.role !== 'LOAN_SEEKER' && <div className="card"><LiveMap job={job} /><MarketChart make={job.make} model={job.model} /></div>}
    {user.role !== 'LOAN_SEEKER' && job.ledger?.length > 0 && <details open><summary><b>{user.role === 'BANK' ? 'Portal ledger' : 'Payments & Ledger'}</b></summary><table><tbody>{job.ledger.map((l) => <tr key={l.id}><td>{l.type}</td><td>{l.fromParty} → {l.toParty}</td><td>{inr(l.amount)}</td><td>{user.role === 'BANK' ? `${l.status} · portal record only` : l.status}</td></tr>)}</tbody></table></details>}
  </div>;
}

function Dashboard() {
  const user = sessionUser(); const nav = useNavigate();
  const [jobs, setJobs] = useState([]); const [selId, setSelId] = useState(null); const [overview, setOverview] = useState(null);
  const [inspectors, setInspectors] = useState([]); const [users, setUsers] = useState([]); const [ledger, setLedger] = useState([]); const [notifs, setNotifs] = useState([]);
  const [tab, setTab] = useState('jobs'); const [err, setErr] = useState(''); const [banner, setBanner] = useState('');
  const [liveEvents, setLiveEvents] = useState([]); const [liveOn, setLiveOn] = useState(false); const [createdJob, setCreatedJob] = useState(null);
  const [jobForm, setJobForm] = useState({ seekerName: '', seekerEmail: '', loanRef: '', regNumber: '', make: '', model: '', year: '', vehicleLat: '', vehicleLng: '', address: '' });
  const sel = jobs.find((j) => j.id === selId) || null;
  const reload = async () => {
    const j = await api('/jobs'); setJobs(j);
    if (user.role === 'ADMIN') { setOverview(await api('/admin/overview')); setLedger(await api('/admin/ledger')); setInspectors(await api('/admin/inspectors')); setUsers(await api('/admin/users')); }
    if (user.role === 'BANK' || user.role === 'INSPECTOR') setLedger(await api('/admin/ledger'));
    setNotifs(await api('/admin/notifications')); return j;
  };
  useEffect(() => { reload().catch((e) => setErr(e.message)); }, []);
  const prevStatus = useRef({});
  useEffect(() => { // celebration watcher: report delivery & settlement, from any role, live
    jobs.forEach((j) => {
      const prev = prevStatus.current[j.id];
      if (prev && prev !== j.status && j.status === 'REPORT_DELIVERED') fireCelebration(`Report Delivered · ${j.regNumber}`);
      if (prev && prev !== j.status && j.status === 'SETTLED') fireCelebration(user.role === 'BANK' ? `Settlement Recorded in Portal · ${j.regNumber}` : `Payment Settled · ${j.regNumber}`);
      prevStatus.current[j.id] = j.status;
    });
  }, [jobs]);
  const [toasts, setToasts] = useState([]); const lastToast = useRef('');
  useEffect(() => { const e = liveEvents[0]; if (!e || !e.at || e.at === lastToast.current) return; lastToast.current = e.at;
    const id = `${e.at}-${Math.random()}`; setToasts((t) => [{ id, text: `${e.type.replaceAll('_', ' ')} ${e.regNumber || ''}` }, ...t].slice(0, 3));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000); }, [liveEvents]);
  useEffect(() => { // live channel: reload portal data on workflow events, not market ticks
    let alive = true; let ws = null; let reconnectTimer = null; let retryDelay = 1000;
    const connect = () => {
      if (!alive) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token() || '')}`);
      ws.onopen = () => { setLiveOn(true); retryDelay = 1000; };
      ws.onclose = () => { setLiveOn(false); if (alive) { reconnectTimer = setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 2, 15000); } };
      ws.onerror = () => { try { ws?.close(); } catch { /* reconnect on close */ } };
      ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (['CONNECTED', 'PONG', 'MARKET_TICK'].includes(m.type)) return; setLiveEvents((p) => [m, ...p].slice(0, 12)); setBanner(`⚡ ${m.type} ${m.regNumber || ''}`); reload().catch(() => {}); } catch { /* resilient */ } };
    };
    connect();
    const ping = setInterval(() => { try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PING' })); } catch { /* noop */ } }, 25000);
    return () => { alive = false; clearTimeout(reconnectTimer); clearInterval(ping); ws?.close(); };
  }, []);
  if (!user) return <Navigate to="/" />;
  const meta = ROLE_META[user.role] || ROLE_META.LOAN_SEEKER;
  const available = jobs.filter((j) => j.status === 'BROADCAST');
  const myTasks = jobs.filter((j) => j.assignedInspector?.id === user.id || (j.status !== 'BROADCAST' && user.role === 'INSPECTOR'));
  const auditQueue = jobs.filter((j) => j.status === 'AUDIT_REQUIRED');
  const toSettle = jobs.filter((j) => j.status === 'REPORT_DELIVERED');
  const earnings = ledger.filter((l) => ['INSPECTOR_INSTANT_PAY', 'INSPECTOR_BONUS'].includes(l.type)).reduce((s, l) => s + l.amount, 0);
  const open = (j) => { setSelId(j.id); document.getElementById('job-detail')?.scrollIntoView({ behavior: 'smooth' }); };
  const recordSettlement = async (job) => { await api(`/jobs/${job.id}/settle`, { method: 'POST' }); await reload(); setBanner(`Settlement status recorded in the portal for ${job.regNumber}. No transfer was initiated or verified.`); };
  const dashboardTabs = <div className={`tabs${user.role === 'BANK' ? ' bank-dashboard-tabs' : ''}`}>
    <button className={tab === 'jobs' ? 'on' : ''} onClick={() => setTab('jobs')}>{user.role === 'BANK' ? 'Valuation Jobs' : 'All Jobs'} ({jobs.length})</button>
    {user.role !== 'LOAN_SEEKER' && <button className={tab === 'ledger' ? 'on' : ''} onClick={() => setTab('ledger')}>{user.role === 'BANK' ? 'Portal Ledger' : 'Payments & Ledger'}</button>}
    <button className={tab === 'notifs' ? 'on' : ''} onClick={() => setTab('notifs')}>Notifications ({notifs.filter((n) => !n.isRead).length})</button>
    {user.role === 'BANK' && <button className={tab === 'analytics' ? 'on' : ''} onClick={() => setTab('analytics')}>🤖 AI Analytics</button>}
  </div>;
  return <div><div className="push-stack">{toasts.map((t) => <div key={t.id} className="push-toast">🔔 {t.text}</div>)}</div><header className="topbar" style={{ background: meta.color }}><div><div className="brand">{meta.icon} Valuation <span>Techno</span></div><div className="tag">{meta.title} · {meta.home}</div></div>
    <div style={{ textAlign: 'right' }}>{user.name} · <b>{user.role}</b>{user.role === 'INSPECTOR' ? ` · ★ ${user.rating}` : ''}<br /><Btn ghost action={async () => { await logoutApi(); nav('/'); }}>Logout</Btn></div></header>
  <div className="wrap">{err && <div className="err">{err}</div>}{banner && <div className="ok">{banner} <Btn ghost action={async () => setBanner('')}>OK</Btn></div>}
    <div className="toastbar"><span className="live-dot"></span> {liveOn ? 'LIVE — real-time updates connected (no refresh needed)' : 'Connecting live channel…'}{liveEvents[0] ? ` · Latest: ${liveEvents[0].type} ${liveEvents[0].regNumber || ''}` : ''}</div>

    {user.role === 'BANK' && <>
      <div className="bank-page-intro"><span className="bank-eyebrow">LOAN & JOB CREATION</span><h1>Create Valuation Job</h1><p>Enter the loan and vehicle details to create a valuation job for this loan.</p></div>
      <div className="card bank-job-card">
        <div className="bank-section-heading"><div><h2>Loan & Vehicle Details</h2><p className="muted">Create a job, then follow inspector progress and the valuation report below.</p></div></div>
        <div className="bank-job-fields">
          <div className="bank-job-field bank-field-4"><label htmlFor="bank-seeker-name">Loan Seeker Name *</label><input id="bank-seeker-name" autoComplete="name" value={jobForm.seekerName} onChange={(e) => setJobForm({ ...jobForm, seekerName: e.target.value })} placeholder="Enter loan seeker name" /></div>
          <div className="bank-job-field bank-field-4"><label htmlFor="bank-seeker-email">Loan Seeker Email *</label><input id="bank-seeker-email" type="email" autoComplete="email" value={jobForm.seekerEmail} onChange={(e) => setJobForm({ ...jobForm, seekerEmail: e.target.value })} placeholder="Enter loan seeker email" /></div>
          <div className="bank-job-field bank-field-4"><label htmlFor="bank-reg-number">Vehicle Registration *</label><input id="bank-reg-number" value={jobForm.regNumber} onChange={(e) => setJobForm({ ...jobForm, regNumber: e.target.value })} placeholder="Enter vehicle registration number" /></div>
          <div className="bank-job-field bank-field-3"><label htmlFor="bank-loan-ref">Loan Reference *</label><input id="bank-loan-ref" value={jobForm.loanRef} onChange={(e) => setJobForm({ ...jobForm, loanRef: e.target.value })} placeholder="Enter loan reference number" /></div>
          <div className="bank-job-field bank-field-3"><label htmlFor="bank-vehicle-make">Make *</label><input id="bank-vehicle-make" type="text" value={jobForm.make} onChange={(e) => setJobForm({ ...jobForm, make: e.target.value })} placeholder="Enter vehicle make" /></div>
          <div className="bank-job-field bank-field-3"><label htmlFor="bank-vehicle-model">Model *</label><input id="bank-vehicle-model" type="text" value={jobForm.model} onChange={(e) => setJobForm({ ...jobForm, model: e.target.value })} placeholder="Enter vehicle model" /></div>
          <div className="bank-job-field bank-field-3"><label htmlFor="bank-vehicle-year">Year *</label><input id="bank-vehicle-year" type="number" min="1990" max={new Date().getFullYear()} step="1" value={jobForm.year} onChange={(e) => setJobForm({ ...jobForm, year: e.target.value })} placeholder="Enter year" /></div>
          <div className="bank-job-field bank-field-5"><label htmlFor="bank-vehicle-address">Vehicle Location *</label><input id="bank-vehicle-address" value={jobForm.address} onChange={(e) => setJobForm({ ...jobForm, address: e.target.value })} placeholder="Enter vehicle location (city / area / address)" /></div>
          <div className="bank-job-field bank-field-2"><label htmlFor="bank-vehicle-lat">Vehicle GPS Latitude *</label><input id="bank-vehicle-lat" type="number" step="any" min="-90" max="90" value={jobForm.vehicleLat} onChange={(e) => setJobForm({ ...jobForm, vehicleLat: e.target.value })} placeholder="Lat" /></div>
          <div className="bank-job-field bank-field-2"><label htmlFor="bank-vehicle-lng">Vehicle GPS Longitude *</label><input id="bank-vehicle-lng" type="number" step="any" min="-180" max="180" value={jobForm.vehicleLng} onChange={(e) => setJobForm({ ...jobForm, vehicleLng: e.target.value })} placeholder="Long" /></div>
          <div className="bank-job-field bank-field-3 bank-job-field-submit"><span className="bank-field-spacer" aria-hidden="true" /><Btn action={async () => {
            const seekerName = jobForm.seekerName.trim();
            const seekerEmail = jobForm.seekerEmail.trim().toLowerCase();
            const regNumber = jobForm.regNumber.trim().toUpperCase().replace(/\s/g, '');
            const make = jobForm.make.trim();
            const model = jobForm.model.trim();
            const year = Number(jobForm.year);
            const vehicleLat = Number(jobForm.vehicleLat);
            const vehicleLng = Number(jobForm.vehicleLng);
            if (seekerName.length < 2) throw new Error('Please enter the loan seeker name (at least 2 characters)');
            if (!seekerEmail || !/^\S+@\S+\.\S+$/.test(seekerEmail)) throw new Error('Please enter a valid loan seeker email');
            if (!/^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/.test(regNumber)) throw new Error('Please enter a valid Indian registration format (e.g. TN38AB1234)');
            if (!jobForm.loanRef.trim()) throw new Error('Please enter the loan reference');
            if (!make || !model) throw new Error('Please enter the vehicle make and model');
            if (!Number.isInteger(year) || year < 1990 || year > new Date().getFullYear()) throw new Error('Please enter a valid vehicle year');
            if (!jobForm.address.trim()) throw new Error('Please enter the vehicle location');
            if (jobForm.vehicleLat === '' || jobForm.vehicleLng === '' || !Number.isFinite(vehicleLat) || !Number.isFinite(vehicleLng) || vehicleLat < -90 || vehicleLat > 90 || vehicleLng < -180 || vehicleLng > 180) throw new Error('Please enter valid latitude and longitude for inspector matching');
            const payload = { seekerName, seekerEmail, loanRef: jobForm.loanRef.trim(), regNumber, make, model, year, vehicleLat, vehicleLng, address: jobForm.address.trim() };
            const j = await api('/jobs', { method: 'POST', body: JSON.stringify(payload) });
            setJobForm({ seekerName: '', seekerEmail: '', loanRef: '', regNumber: '', make: '', model: '', year: '', vehicleLat: '', vehicleLng: '', address: '' });
            setCreatedJob(j); fireCelebration(`Job Created & Broadcast · ${j.regNumber}`); await reload(); setTab('jobs'); setSelId(j.id);
            setBanner(`✓ ${j.regNumber} job created and broadcast to eligible inspectors.`);
            setTimeout(() => document.getElementById('created-job-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250);
          }}>Create Valuation Job →</Btn></div>
        </div>
        <p className="bank-job-help">Vehicle coordinates are used for inspector radius matching. RC, insurance and claim checks require authorized provider access; those external checks are not connected.</p>
        {createdJob && <div id="created-job-result" className="ok" style={{ textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><SuccessTick size={44} /><b>JOB CREATED & BROADCAST</b></div>
          {createdJob.make} {createdJob.model} · {createdJob.regNumber} · Status: <b>{createdJob.status}</b><br />
          <b>Eligible inspectors:</b> {(createdJob.eligibleInspectors || []).length ? `${createdJob.eligibleInspectors.length}; awaiting acceptance.` : 'None currently available for this job.'}<br />
          <span className="muted">Portal job progress updates when an inspector accepts or submits the inspection.</span>
          <div style={{ marginTop: 8 }}><Btn ghost action={async () => { setSelId(createdJob.id); setTimeout(() => document.getElementById('job-detail')?.scrollIntoView({ behavior: 'smooth' }), 200); }}>View Job Details ↓</Btn></div>
        </div>}
      </div>
      {dashboardTabs}
      {tab === 'jobs' && <BankJobProgressTable jobs={jobs} open={open} liveOn={liveOn} />}
    </>}

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

    {user.role !== 'ADMIN' && <>{user.role !== 'BANK' && dashboardTabs}
    {tab === 'jobs' && user.role !== 'BANK' && <div className="card"><table><thead><tr><th>Vehicle</th><th>Reg</th><th>Status</th><th>Valuation</th><th>Action</th></tr></thead><tbody>{jobs.map((j) => <tr key={j.id}><td><span className="veh-cell"><img className="car-thumb" src={carPhotoFor(j)} alt="" loading="lazy" /><span>{j.make} {j.model} ({j.year})<br /><span className="muted">{fmtDate(j.createdAt)}</span></span></span></td><td>{j.regNumber}</td><td><StatusPill s={j.status} /></td><td>{j.valuation?.finalValuation ? inr(j.valuation.finalValuation) : j.valuation ? `${j.valuation.variancePct}% ${j.valuation.flag}` : '—'}</td><td><Btn ghost action={async () => open(j)}>Open →</Btn></td></tr>)}</tbody></table>{jobs.length === 0 && <p className="muted">No jobs yet.</p>}</div>}
    {tab === 'ledger' && user.role !== 'LOAN_SEEKER' && <div className="card">{user.role === 'BANK' && <p className="muted">Internal portal entries only; statuses do not verify external transfers.</p>}<table><thead><tr><th>Type</th><th>From → To</th><th>Amount</th><th>{user.role === 'BANK' ? 'Portal record status' : 'Status'}</th><th>Date</th></tr></thead><tbody>{ledger.map((l) => <tr key={l.id}><td>{l.type}</td><td>{l.fromParty} → {l.toParty}</td><td>{inr(l.amount)}</td><td>{user.role === 'BANK' ? `${l.status} · not transfer-verified` : l.status}</td><td>{fmtDate(l.createdAt)}</td></tr>)}</tbody></table>{ledger.length === 0 && <p className="muted">No transactions yet.</p>}</div>}
    {tab === 'notifs' && <div className="card">{notifs.map((n) => <p key={n.id}><b>{n.title}</b><br /><span className="muted">{n.body} · {fmtDate(n.createdAt)}</span></p>)}{notifs.length === 0 && <p className="muted">No notifications yet.</p>}</div>}
    {tab === 'analytics' && user.role === 'BANK' && <ErrorBoundary><div className="bank-analytics-view"><div className="card"><div className="bank-section-heading"><div><h2>🤖 AI Analytics</h2><p className="muted">Portfolio trends, valuation variance and fraud-risk summaries.</p></div><AiMotion label="AI analytics preview" detail="Simulated outputs · no live provider" /></div><p className="bank-job-help">Preview notice: AI, fraud and market outputs are simulated; external providers are not connected. Ledger amounts are portal records, not verified transfers. Valuation flags are not loan approvals—the Bank makes the final loan decision.</p></div><AnalyticsPanel /></div></ErrorBoundary>}
    </>}
    <div id="job-detail">{sel && <ErrorBoundary><JobDetail job={sel} user={user} reload={reload} onClose={() => setSelId(null)} /></ErrorBoundary>}</div>
    {user.role === 'BANK' && tab === 'jobs' && <BankSettlementQueue toSettle={toSettle} open={open} recordSettlement={recordSettlement} />}
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
      <div className="splash-meta"><span>Loading the valuation portal…</span><b>{pct}%</b></div>
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
