const BASE = '/api';
export const token = () => localStorage.getItem('vt_token');
export const sessionUser = () => { try { return JSON.parse(localStorage.getItem('vt_user')); } catch { return null; } };
export function setSession(t, u) { localStorage.setItem('vt_token', t); localStorage.setItem('vt_user', JSON.stringify(u)); }
export function clearSession() { localStorage.removeItem('vt_token'); localStorage.removeItem('vt_user'); }
export async function api(path, opts = {}) {
  const t = token();
  // Send the token three ways: Bearer, X-Auth-Token, and the HttpOnly cookie set at login.
  // Some preview/proxy layers strip Authorization — the other transports keep the session alive.
  const res = await fetch(BASE + path, {
    credentials: 'same-origin',
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}`, 'X-Auth-Token': t } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  if (res.status === 401 && t && !path.startsWith('/auth/')) {
    // Session truly expired (e.g. server data reset) — send the user back to login instead of dead buttons.
    clearSession();
    if (location.pathname !== '/') { sessionStorage.setItem('vt_notice', 'Session expired — please login again.'); location.href = '/'; }
    throw new Error('Session expired — please login again.');
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}
export async function logoutApi() { try { await fetch(BASE + '/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* best effort */ } clearSession(); }
// Open an authenticated report without relying on blob-URL navigation, which some
// embedded preview browsers block. HTML is written into the synchronously opened
// tab; binary reports (PDF) still use a blob URL. If pop-ups are blocked, fall back
// to the current tab so the report remains reachable instead of silently doing nothing.
export async function openAuthed(path) {
  const w = window.open('about:blank', '_blank'); const t = token();
  try {
    const res = await fetch(path.startsWith('/api') ? path : BASE + path, { credentials: 'same-origin', headers: { ...(t ? { Authorization: `Bearer ${t}`, 'X-Auth-Token': t } : {}) } });
    if (!res.ok) {
      const tx = await res.text(); let message = tx;
      try { message = JSON.parse(tx)?.error || tx; } catch { /* response is plain text */ }
      throw new Error(message.slice(0, 200) || `Failed (${res.status})`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await res.text();
      if (w && !w.closed) { w.document.open(); w.document.write(html); w.document.close(); w.scrollTo(0, 0); setTimeout(() => { if (!w.closed) w.scrollTo(0, 0); }, 0); }
      else { const url = URL.createObjectURL(new Blob([html], { type: contentType })); window.location.assign(url); setTimeout(() => URL.revokeObjectURL(url), 60000); }
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    if (w && !w.closed) w.location.replace(url);
    else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    if (w && !w.closed) w.close();
    throw error;
  }
}
export async function downloadAuthed(path, filename) {
  const url = path.startsWith('/api') ? path : BASE + path;
  // Open the file in a new browser tab: the HttpOnly session cookie authenticates
  // the request and the server replies with Content-Disposition: attachment, so
  // the browser downloads it. A programmatic blob download is silently blocked
  // inside sandboxed preview iframes, which is why the new tab is used first.
  const w = window.open(url, '_blank');
  if (w) return;
  // Fallback (pop-ups blocked): fetch as blob and trigger a normal download.
  const t = token();
  const res = await fetch(url, { credentials: 'same-origin', headers: { ...(t ? { Authorization: `Bearer ${t}`, 'X-Auth-Token': t } : {}) } });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob(); const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = objUrl; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
}
// Fetch an authenticated file (e.g. the report QR image) and return a blob object URL.
// A plain <img src="/api/..."> cannot attach the login token, and preview/proxy frames
// may not send the session cookie on image loads — the QR then shows as a broken icon.
// Loading it through this authed fetch (same mechanism as reports) always works.
export async function blobUrl(path) {
  const t = token();
  const res = await fetch(path.startsWith('/api') ? path : BASE + path, { credentials: 'same-origin', headers: { ...(t ? { Authorization: `Bearer ${t}`, 'X-Auth-Token': t } : {}) } });
  if (!res.ok) throw new Error(`Failed (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
export const inr = (n) => n === null || n === undefined ? '—' : '₹' + Number(n).toLocaleString('en-IN');
export const fmtDate = (s) => s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
