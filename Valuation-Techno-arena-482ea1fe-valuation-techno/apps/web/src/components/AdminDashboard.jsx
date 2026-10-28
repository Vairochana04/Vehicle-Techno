import { useEffect, useMemo, useState } from 'react';
import { api, inr, fmtDate, downloadAuthed } from '../api.js';
import { carPhotoFor } from '../carPhotos.js';
import { AnalyticsPanel, ErrorBoundary } from './Advanced.jsx';

function AdminButton({ action, children, tone = '', small = false }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  return <span className="adm-btn-wrap">
    <button type="button" disabled={busy} className={`adm-btn ${tone} ${small ? 'adm-btn-small' : ''}`} onClick={async () => { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); } }}>{busy ? 'Working…' : children}</button>
    {error && <small className="adm-btn-error">{error}</small>}
  </span>;
}

export function DonutChart({ title, subtitle, data, centerValue, centerLabel }) {
  const total = data.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const radius = 58; const circumference = 2 * Math.PI * radius;
  let accumulated = 0;
  const segments = data.filter((item) => item.value > 0).map((item) => {
    const fraction = total ? item.value / total : 0;
    const segment = { ...item, fraction, dash: Math.max(0, fraction * circumference - 3), offset: -accumulated * circumference };
    accumulated += fraction; return segment;
  });
  return <section className="adm-panel adm-donut-panel">
    <div className="adm-panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div><span className="adm-total-badge">{total} total</span></div>
    <div className="adm-donut-layout">
      <div className="adm-donut-svg-wrap">
        <svg viewBox="0 0 160 160" className="adm-donut" role="img" aria-label={title}>
          <circle cx="80" cy="80" r={radius} className="adm-donut-track" />
          {segments.map((item) => <circle key={item.label} cx="80" cy="80" r={radius} fill="none" stroke={item.color} strokeWidth="17" strokeLinecap="round" strokeDasharray={`${item.dash} ${circumference}`} strokeDashoffset={item.offset} transform="rotate(-90 80 80)" className="adm-donut-segment" />)}
          <text x="80" y="76" textAnchor="middle" className="adm-donut-center-value">{centerValue ?? total}</text>
          <text x="80" y="96" textAnchor="middle" className="adm-donut-center-label">{centerLabel || 'records'}</text>
        </svg>
      </div>
      <div className="adm-donut-legend">
        {data.map((item) => <div className="adm-legend-row" key={item.label}><span className="adm-legend-dot" style={{ background: item.color }} /><span>{item.label}</span><strong>{item.value}</strong><small>{total ? Math.round((item.value / total) * 100) : 0}%</small></div>)}
        {total === 0 && <p className="adm-muted">No data available yet.</p>}
      </div>
    </div>
  </section>;
}

function ProgressRing({ label, value, display, color = '#38bdf8', caption }) {
  const pct = Math.max(0, Math.min(100, Number(value || 0))); const radius = 43; const circumference = 2 * Math.PI * radius;
  return <div className="adm-ring-card">
    <svg viewBox="0 0 110 110" className="adm-progress-ring">
      <circle cx="55" cy="55" r={radius} className="adm-ring-track" />
      <circle cx="55" cy="55" r={radius} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference - (pct / 100) * circumference} transform="rotate(-90 55 55)" />
      <text x="55" y="53" textAnchor="middle" className="adm-ring-value">{display}</text><text x="55" y="70" textAnchor="middle" className="adm-ring-label">{label}</text>
    </svg><p>{caption}</p>
  </div>;
}

function RatingRing({ rating }) {
  const pct = (Number(rating || 0) / 5) * 100; const radius = 25; const circumference = 2 * Math.PI * radius;
  return <span className="adm-rating-ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r={radius} className="adm-ring-track" /><circle cx="32" cy="32" r={radius} fill="none" stroke="#fbbf24" strokeWidth="6" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference - (pct / 100) * circumference} transform="rotate(-90 32 32)" /><text x="32" y="37" textAnchor="middle">{Number(rating || 0).toFixed(1)}</text></svg></span>;
}

const STATUS_COLORS = { BROADCAST: '#22d3ee', ASSIGNED: '#a78bfa', INSPECTION_IN_PROGRESS: '#fbbf24', INSPECTION_SUBMITTED: '#fb923c', AUDIT_REQUIRED: '#fb7185', REPORT_DELIVERED: '#34d399', SETTLED: '#a3e635', RE_INSPECTION_REQUIRED: '#f472b6', CANCELLED: '#94a3b8' };
const ROLE_COLORS = { ADMIN: '#c084fc', BANK: '#38bdf8', INSPECTOR: '#34d399', LOAN_SEEKER: '#fbbf24' };
const countBy = (items, key) => items.reduce((acc, item) => { const value = item[key] || 'Unknown'; acc[value] = (acc[value] || 0) + 1; return acc; }, {});

export default function AdminControlCenter({ jobs = [], overview, users = [], inspectors = [], ledger = [], liveOn, openJob, reload }) {
  const [section, setSection] = useState('overview');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [radius, setRadius] = useState(overview?.radiusKm || 25);

  const auditQueue = useMemo(() => jobs.filter((job) => job.status === 'AUDIT_REQUIRED'), [jobs]);
  const statusData = useMemo(() => Object.entries(countBy(jobs, 'status')).map(([label, value]) => ({ label: label.replaceAll('_', ' '), value, color: STATUS_COLORS[label] || '#94a3b8' })), [jobs]);
  const roleData = useMemo(() => Object.entries(countBy(users, 'role')).map(([label, value]) => ({ label: label.replaceAll('_', ' '), value, color: ROLE_COLORS[label] || '#94a3b8' })), [users]);
  const green = jobs.filter((job) => job.valuation?.flag === 'GREEN').length;
  const red = jobs.filter((job) => job.valuation?.flag === 'RED').length;
  const flagData = [{ label: 'Green flags', value: green, color: '#34d399' }, { label: 'Red flags', value: red, color: '#fb7185' }, { label: 'Awaiting valuation', value: Math.max(0, jobs.length - green - red), color: '#64748b' }];
  const delivered = jobs.filter((job) => ['REPORT_DELIVERED', 'SETTLED'].includes(job.status)).length;
  const settled = jobs.filter((job) => job.status === 'SETTLED').length;
  const completion = jobs.length ? Math.round((delivered / jobs.length) * 100) : 0;
  const greenRate = green + red ? Math.round((green / (green + red)) * 100) : 0;
  const activeRate = users.length ? Math.round((users.filter((user) => user.status === 'ACTIVE').length / users.length) * 100) : 0;
  const health = Math.round((completion + greenRate + activeRate) / 3);
  const filteredUsers = users.filter((user) => (roleFilter === 'ALL' || user.role === roleFilter) && `${user.name} ${user.email} ${user.role}`.toLowerCase().includes(query.toLowerCase()));

  const setUserStatus = async (user, status) => { await api(`/admin/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); await reload(); };
  const [auditLog, setAuditLog] = useState([]);
  useEffect(() => { api('/admin/audit-log').then(setAuditLog).catch(() => {}); }, []);
  const nav = [
    ['overview', '◉', 'Overview', jobs.length], ['audit', '●', 'Audit Queue', auditQueue.length], ['users', '👥', 'User Management', users.length],
    ['inspectors', '★', 'Inspectors', inspectors.length], ['jobs', '🚗', 'All Jobs', jobs.length], ['payments', '₹', 'Payments', ledger.length], ['analytics', '◈', 'AI Analytics', null], ['settings', '⚙', 'Settings', null],
  ];

  return <section className="adm-center" id="admin-control-centre">
    <div className="adm-layout">
      <aside className="adm-sidebar">
        <div className="adm-side-brand"><span className="adm-logo">VT</span><div><strong>Valuation Techno</strong><small>Admin Control Centre</small></div></div>
        <p className="adm-side-label">Manage Platform</p>
        <nav>{nav.map(([key, icon, label, count]) => <button key={key} type="button" className={section === key ? 'active' : ''} onClick={() => setSection(key)}><span>{icon}</span>{label}{count !== null && <em>{count}</em>}</button>)}</nav>
        <div className="adm-live-box"><span className={liveOn ? 'adm-live-dot' : 'adm-offline-dot'} />{liveOn ? 'Live system connected' : 'Connecting live system…'}<small>Users, jobs, audits and payments update here.</small></div>
      </aside>

      <div className="adm-main">
        <div className="adm-hero">
          <div><p className="adm-eyebrow">Platform Administration</p><h2>Good morning, Admin 👋</h2><p>Manage banks, inspectors, loan seekers, valuation jobs, red-flag audits, payments and platform settings from one place.</p></div>
          <ProgressRing label="Health" value={health} display={`${health}%`} color="#38bdf8" caption="Overall platform health" />
        </div>

        {section === 'overview' && <>
          <div className="adm-kpi-grid">
            <article className="adm-kpi adm-kpi-blue"><span>Total Jobs</span><strong>{jobs.length}</strong><small>{overview?.broadcast || 0} currently broadcasting</small><ProgressRing label="Done" value={completion} display={`${completion}%`} color="#38bdf8" caption="Reports delivered" /></article>
            <article className="adm-kpi adm-kpi-violet"><span>Platform Users</span><strong>{users.length}</strong><small>{users.filter((u) => u.status === 'ACTIVE').length} active accounts</small><ProgressRing label="Active" value={activeRate} display={`${activeRate}%`} color="#a78bfa" caption="Active user ratio" /></article>
            <article className="adm-kpi adm-kpi-red"><span>Red-Flag Audits</span><strong>{auditQueue.length}</strong><small>Require senior review</small><ProgressRing label="Audit" value={jobs.length ? (auditQueue.length / jobs.length) * 100 : 0} display={auditQueue.length} color="#fb7185" caption="Pending audit jobs" /></article>
            <article className="adm-kpi adm-kpi-green"><span>Settled Revenue</span><strong>{inr(overview?.ledgerTotal || 0)}</strong><small>{settled} fully settled jobs</small><ProgressRing label="Settled" value={jobs.length ? (settled / jobs.length) * 100 : 0} display={`${jobs.length ? Math.round((settled / jobs.length) * 100) : 0}%`} color="#34d399" caption="Settlement completion" /></article>
          </div>

          <div className="adm-chart-grid">
            <DonutChart title="Job Status Distribution" subtitle="Every valuation stage across the platform" data={statusData} centerLabel="jobs" />
            <DonutChart title="Valuation Flag Analysis" subtitle="Green approvals versus red-flag audits" data={flagData} centerLabel="valuations" />
            <DonutChart title="User Role Distribution" subtitle="Everyone managed by the Admin" data={roleData} centerLabel="users" />
          </div>

          <div className="adm-two-grid">
            <section className="adm-panel"><div className="adm-panel-heading"><div><h3>Priority Audit Queue</h3><p>Highest-attention jobs requiring action</p></div><button type="button" className="adm-link-btn" onClick={() => setSection('audit')}>View all →</button></div>
              {auditQueue.slice(0, 4).map((job) => <div className="adm-list-row" key={job.id}><span className="adm-danger-icon">!</span><div><strong>{job.regNumber}</strong><small>{job.make} {job.model} · Variance {job.valuation?.variancePct || 0}%</small></div><AdminButton small action={() => openJob(job)}>Review</AdminButton></div>)}
              {auditQueue.length === 0 && <p className="adm-success-note">✓ No red-flag jobs are waiting. The audit queue is clear.</p>}
            </section>
            <section className="adm-panel"><div className="adm-panel-heading"><div><h3>Top Inspectors</h3><p>Performance based on composite ratings</p></div><button type="button" className="adm-link-btn" onClick={() => setSection('inspectors')}>Manage →</button></div>
              {[...inspectors].sort((a, b) => b.rating - a.rating).slice(0, 4).map((inspector) => <div className="adm-list-row" key={inspector.id}><RatingRing rating={inspector.rating} /><div><strong>{inspector.name}</strong><small>{inspector.ratingCount} rated jobs · {inspector.status}</small></div><span className="adm-rating-text">★ {inspector.rating}</span></div>)}
            </section>
          </div>
        </>}

        {section === 'audit' && <section className="adm-panel"><div className="adm-panel-heading"><div><h3>🔴 Red-Flag Audit Queue</h3><p>Variance above 5% requires approval, senior review, or re-inspection.</p></div><span className="adm-total-badge">{auditQueue.length} pending</span></div>
          {auditQueue.map((job) => <div className="adm-audit-row" key={job.id}><div><strong>{job.regNumber}</strong><small>{job.make} {job.model} · {fmtDate(job.createdAt)}</small></div><div className="adm-variance"><span>Variance</span><strong>{job.valuation?.variancePct}%</strong><i style={{ width: `${Math.min(100, job.valuation?.variancePct || 0)}%` }} /></div><span>AI {inr(job.valuation?.aiValuation)}</span><span>Manual {inr(job.valuation?.manualValuation)}</span><AdminButton action={() => openJob(job)}>Review & Decide</AdminButton></div>)}
          {auditQueue.length === 0 && <p className="adm-success-note">✓ Audit queue clear — no red-flag jobs need attention.</p>}</section>}

        {section === 'users' && <section className="adm-panel"><div className="adm-panel-heading"><div><h3>👥 User Management</h3><p>Manage administrators, banks, inspectors and loan seekers.</p></div><span className="adm-total-badge">{filteredUsers.length} shown</span></div>
          <div className="adm-filter-row"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or role…" /><select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}><option value="ALL">All Roles</option><option>ADMIN</option><option>BANK</option><option>INSPECTOR</option><option>LOAN_SEEKER</option></select></div>
          <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>User</th><th>Role</th><th>Contact</th><th>Rating</th><th>Status</th><th>Manage</th></tr></thead><tbody>{filteredUsers.map((user) => <tr key={user.id}><td><strong>{user.name}</strong><small>{user.bankName || 'Valuation Techno User'}</small></td><td><span className="adm-role" style={{ '--role': ROLE_COLORS[user.role] }}>{user.role.replaceAll('_', ' ')}</span></td><td>{user.email}<small>{user.phone || 'No phone added'}</small></td><td>{user.role === 'INSPECTOR' ? `★ ${user.rating} (${user.ratingCount})` : '—'}</td><td><span className={`adm-status status-${user.status.toLowerCase()}`}>{user.status}</span></td><td>{user.role === 'ADMIN' ? <span className="adm-protected">Protected</span> : <div className="adm-actions"><AdminButton small tone={user.status === 'ACTIVE' ? 'outline' : 'green'} action={() => setUserStatus(user, 'ACTIVE')}>Activate</AdminButton>{user.role === 'INSPECTOR' && <AdminButton small tone="amber" action={() => setUserStatus(user, 'RETRAINING')}>Retraining</AdminButton>}<AdminButton small tone="danger" action={() => setUserStatus(user, 'SUSPENDED')}>Suspend</AdminButton></div>}</td></tr>)}</tbody></table></div>
          {filteredUsers.length === 0 && <p className="adm-muted">No users match your search.</p>}</section>}

        {section === 'inspectors' && <section className="adm-panel"><div className="adm-panel-heading"><div><h3>★ Inspector Management</h3><p>Ratings, workload quality, retraining and suspension controls.</p></div></div>
          <div className="adm-inspector-grid">{inspectors.map((inspector) => <article className="adm-inspector-card" key={inspector.id}><RatingRing rating={inspector.rating} /><div><strong>{inspector.name}</strong><small>{inspector.email}</small><span className={`adm-status status-${inspector.status.toLowerCase()}`}>{inspector.status}</span></div><div className="adm-actions"><AdminButton small tone="green" action={() => setUserStatus(inspector, 'ACTIVE')}>Active</AdminButton><AdminButton small tone="amber" action={() => setUserStatus(inspector, 'RETRAINING')}>Retraining</AdminButton><AdminButton small tone="danger" action={() => setUserStatus(inspector, 'SUSPENDED')}>Suspend</AdminButton></div></article>)}</div></section>}

        {section === 'jobs' && <section className="adm-panel"><div className="adm-panel-heading"><div><h3>🚗 All Valuation Jobs</h3><p>Open any job to inspect valuation, fraud analysis, reports and payments.</p></div><AdminButton small action={() => downloadAuthed('/admin/export/jobs.csv', 'valuation-jobs.csv')}>⬇ Export CSV (Excel)</AdminButton></div><div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Vehicle</th><th>Registration</th><th>Status</th><th>Inspector</th><th>Valuation</th><th>Action</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><span className="veh-cell"><img className="car-thumb" src={carPhotoFor(job)} alt="" loading="lazy" /><span><strong>{job.make} {job.model}</strong><small>{job.year} · {fmtDate(job.createdAt)}</small></span></span></td><td>{job.regNumber}</td><td><span className="adm-job-status" style={{ '--status': STATUS_COLORS[job.status] }}>{job.status.replaceAll('_', ' ')}</span></td><td>{job.assignedInspector?.name || 'Not assigned'}</td><td>{job.valuation?.finalValuation ? inr(job.valuation.finalValuation) : job.valuation ? `${job.valuation.variancePct}% ${job.valuation.flag}` : 'Pending'}</td><td><AdminButton small action={() => openJob(job)}>Open Job</AdminButton></td></tr>)}</tbody></table></div></section>}

        {section === 'payments' && <section className="adm-panel"><div className="adm-panel-heading"><div><h3>₹ Payments & Settlements</h3><p>Recent platform money movement and settlement activity.</p></div><span className="adm-total-badge">{inr(overview?.ledgerTotal || 0)} settled</span></div>
          <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Type</th><th>From → To</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>{ledger.slice(0, 15).map((entry) => <tr key={entry.id}><td>{entry.type.replaceAll('_', ' ')}</td><td>{entry.fromParty} → {entry.toParty}</td><td>{inr(entry.amount)}</td><td>{entry.status}</td><td>{fmtDate(entry.createdAt)}</td></tr>)}</tbody></table></div>{ledger.length === 0 && <p className="adm-muted">No payment records available yet.</p>}</section>}

        {section === 'analytics' && <section className="adm-panel adm-analytics"><div className="adm-panel-heading"><div><h3>AI Analytics</h3><p>Market intelligence, fraud patterns and valuation performance.</p></div></div><ErrorBoundary><AnalyticsPanel /></ErrorBoundary></section>}

        {section === 'auditlog' && <section className="adm-panel"><div className="adm-panel-heading"><div><h3>🧾 Audit Log</h3><p>Every important action in the platform — who did what, and when. Newest first.</p></div><AdminButton small action={async () => setAuditLog(await api('/admin/audit-log'))}>↻ Refresh</AdminButton></div>
          <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Detail</th></tr></thead><tbody>{auditLog.map((entry) => <tr key={entry.id}><td>{fmtDate(entry.createdAt)}</td><td><span className="adm-role">{entry.action}</span></td><td>{entry.actorId ? entry.actorId.slice(0, 8) + '…' : 'System'}</td><td>{entry.detail || '—'}</td></tr>)}</tbody></table></div>{auditLog.length === 0 && <p className="adm-muted">No audit entries yet. Actions like job creation, audits, status changes and settlements will appear here.</p>}</section>}

        {section === 'settings' && <section className="adm-panel adm-settings"><div className="adm-panel-heading"><div><h3>⚙ Platform Settings</h3><p>Control how valuation jobs are allocated to inspectors.</p></div></div>
          <h4>Inspector Allocation Mode</h4><p className="adm-muted">First-Come assigns the first eligible inspector who accepts. Rating Priority gives higher-rated inspectors the first opportunity.</p>
          <div className="adm-segmented"><button type="button" className={overview?.allocationMode === 'FIRST_COME' ? 'active' : ''} onClick={async () => { await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ allocationMode: 'FIRST_COME' }) }); await reload(); }}>First-Come</button><button type="button" className={overview?.allocationMode === 'RATING_PRIORITY' ? 'active' : ''} onClick={async () => { await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ allocationMode: 'RATING_PRIORITY' }) }); await reload(); }}>Rating Priority</button></div>
          <h4>Broadcast Radius: {radius} km</h4><input type="range" min="5" max="100" value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
          <AdminButton action={async () => { await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ radiusKm: radius }) }); await reload(); }}>Save Radius Setting</AdminButton>
          <div className="adm-setting-summary"><span>Current mode<strong>{overview?.allocationMode || 'FIRST_COME'}</strong></span><span>Saved radius<strong>{overview?.radiusKm || radius} km</strong></span><span>Online status<strong>{liveOn ? 'Live' : 'Connecting'}</strong></span></div>
        </section>}
      </div>
    </div>
  </section>;
}
