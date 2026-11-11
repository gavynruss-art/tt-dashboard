'use strict';
const TZ = 'America/Boise';
const LS = { todo: 'tt.todo.v1', custom: 'tt.custom.v1', biz: 'tt.biz.v1', range: 'tt.range.v1', tab: 'tt.tab.v1' };
let D = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (n, signed) => n == null ? 'unknown' : (signed && n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('en-US', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2});
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const dayStr = d => new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
const fmtDate = s => new Date(s.length === 10 ? s + 'T12:00:00-07:00' : s).toLocaleDateString('en-US', {timeZone: TZ, month: 'short', day: 'numeric'});
const fmtWhen = s => s ? new Date(s).toLocaleString('en-US', {timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) + ' MT' : 'Date unknown';

/* ---------- crypto: AES-GCM, PBKDF2-SHA256 key; optional non-extractable key kept in IndexedDB ---------- */
function idb() { return new Promise((res, rej) => { const r = indexedDB.open('tt-desk', 1); r.onupgradeneeded = () => r.result.createObjectStore('keys'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function keyGet(id) { const db = await idb(); return new Promise(res => { const q = db.transaction('keys').objectStore('keys').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
async function keyPut(id, k) { const db = await idb(); return new Promise(res => { const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').put(k, id); t.oncomplete = res; t.onerror = res; }); }
async function keyClear() { const db = await idb(); return new Promise(res => { const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').clear(); t.oncomplete = res; t.onerror = res; }); }
async function fetchEnv() { const r = await fetch('data.enc.json', {cache: 'no-store'}); if (!r.ok) throw new Error('No data file'); return r.json(); }
async function deriveKey(pass, env) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: b64(env.salt), iterations: env.iter}, base, {name: 'AES-GCM', length: 256}, false, ['decrypt']);
}
async function decrypt(key, env) {
  const pt = await crypto.subtle.decrypt({name: 'AES-GCM', iv: b64(env.iv)}, key, b64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
async function unlock(pass, remember) {
  const env = await fetchEnv();
  const key = await deriveKey(pass, env);
  D = await decrypt(key, env);
  if (remember) await keyPut(env.salt, key);
  start();
}
async function tryRemembered() {
  try { const env = await fetchEnv(); const key = await keyGet(env.salt); if (!key) return false; D = await decrypt(key, env); start(); return true; }
  catch { return false; }
}

/* ---------- money math ---------- */
const RANGES = { week: 'This week', month: 'This month', d90: '90 days' };
function rangeStart(r) {
  const today = new Date(dayStr(new Date()) + 'T00:00:00');
  if (r === 'week') { const d = new Date(today); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayStr(d); }
  if (r === 'month') return dayStr(today).slice(0, 8) + '01';
  return dayStr(new Date(today - 89 * 864e5));
}
const inRange = (date, r) => date && date >= rangeStart(r) && date <= dayStr(new Date());
const bizMarks = () => load(LS.biz, {});
const expKey = e => e.date + '|' + e.vendor;
function counted(e) { return e.status === 'confirmed' || bizMarks()[expKey(e)] === true; }
function totals(r) {
  const pays = D.payments.filter(p => inRange(p.date, r));
  const rev = sum(pays.map(p => p.amount));
  const exps = D.expenses.filter(e => inRange(e.date, r));
  const spent = sum(exps.filter(counted).map(e => e.amount));
  const open = exps.filter(e => !counted(e) && bizMarks()[expKey(e)] !== false);
  return { pays, rev, spent, net: rev - spent, open, openAmt: sum(open.map(e => e.amount)),
    tattoo: sum(pays.filter(p => p.type === 'tattoo').map(p => p.amount)), piercing: sum(pays.filter(p => p.type === 'piercing').map(p => p.amount)),
    deposit: sum(pays.filter(p => p.kind === 'deposit').map(p => p.amount)), full: sum(pays.filter(p => p.kind !== 'deposit').map(p => p.amount)) };
}
const sum = a => Math.round(a.reduce((x, y) => x + (y || 0), 0) * 100) / 100;
function weekKey(s) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayStr(d); }
function groupBy(list, kf) { const m = new Map(); for (const x of list) { const k = kf(x); m.set(k, (m.get(k) || 0) + x.amount); } return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])); }
function split(a, b, ca, cb) { const t = a + b || 1; return `<div class="bar"><i style="width:${a / t * 100}%;background:${ca}"></i><i style="width:${b / t * 100}%;background:${cb}"></i></div>`; }

function chair(r) {
  const now = Date.now(), from = rangeStart(r);
  const known = D.appointments.filter(x => x.start && x.minutes);
  const end = x => new Date(x.start).getTime() + x.minutes * 6e4;
  const day = x => dayStr(new Date(x.start));
  const done = known.filter(x => end(x) <= now && day(x) >= from);
  const ahead = known.filter(x => end(x) > now);
  const hrs = l => sum(l.map(x => x.minutes)) / 60;
  const paidOn = l => sum(l.map(x => x.paid || 0));
  const doneH = hrs(done), aheadH = hrs(ahead);
  return { done, ahead, doneH, aheadH, perDone: doneH ? paidOn(done) / doneH : null, perAhead: aheadH ? paidOn(ahead) / aheadH : null,
    unknown: D.appointments.filter(x => !x.minutes).length };
}
const hfmt = h => h < 1 ? Math.round(h * 60) + ' min' : (Math.round(h * 10) / 10) + ' hr';
/* ---------- views ---------- */
function vMoney() {
  const r = load(LS.range, 'd90'); const t = totals(r);
  const seg = `<div class="seg">${Object.entries(RANGES).map(([k, v]) => `<button data-range="${k}" class="${k === r ? 'on' : ''}">${v}</button>`).join('')}</div>`;
  const ifAll = t.openAmt ? `<div class="note">${money(t.openAmt)} in purchases not sorted yet. If all are business: net ${money(t.net - t.openAmt, true)}. <a href="#" data-goto="spend">Sort them</a></div>` : '';
  const weeks = groupBy(D.payments.filter(p => inRange(p.date, 'd90')), p => weekKey(p.date));
  const months = groupBy(D.payments.filter(p => inRange(p.date, 'd90')), p => p.date.slice(0, 7));
  const bank = D.bank || {};
  const draws = (bank.transactions || []).filter(x => x.kind === 'owner_draw');
  return `${seg}
  <div class="hero">
    <div class="card net"><div class="lbl">Net profit · ${RANGES[r]}</div><div class="big ${t.net >= 0 ? 'pos' : 'neg'}">${money(t.net, true)}</div>${ifAll}</div>
    <div class="card"><div class="lbl">Revenue</div><div class="big">${money(t.rev)}</div><div class="note">${t.pays.length} payment${t.pays.length === 1 ? '' : 's'}</div></div>
    <div class="card"><div class="lbl">Spending</div><div class="big">${money(t.spent)}</div><div class="note">confirmed only</div></div>
  </div>
  ${chairCard(r)}
  ${stripeCard()}
  <h2>Revenue mix</h2>
  <div class="card">
    <div class="row"><span><span class="pill tattoo">Tattoo</span> ${money(t.tattoo)}</span><span><span class="pill piercing">Piercing</span> ${money(t.piercing)}</span></div>
    ${split(t.tattoo, t.piercing, 'var(--tat)', 'var(--pie)')}
    <div class="row"><span>Deposits ${money(t.deposit)}</span><span>Paid in full ${money(t.full)}</span></div>
    ${split(t.deposit, t.full, 'var(--ac)', 'var(--ok)')}
    <div class="note">Balances paid in the studio (cash, Venmo, card) aren't in the data yet.</div>
  </div>
  <h2>By week · by month</h2>
  <div class="card">${weeks.map(([k, v]) => `<div class="row"><span>Week of ${fmtDate(k)}</span><strong>${money(v)}</strong></div>`).join('') || '<span class="muted">No payments</span>'}</div>
  <div class="card">${months.map(([k, v]) => `<div class="row"><span>${new Date(k + '-15T12:00:00').toLocaleDateString('en-US', {month: 'long', year: 'numeric'})}</span><strong>${money(v)}</strong></div>`).join('')}</div>
  <h2>Payments</h2>
  <div class="card">${[...D.payments].sort((a, b) => b.date.localeCompare(a.date)).map(p => `<div class="row"><span>${fmtDate(p.date)} · ${esc(p.client)} <span class="pill ${p.type}">${p.type}</span><div class="note">${p.kind === 'deposit' ? 'Deposit' : 'Paid in full'} · ${esc(p.via)}${p.fee ? ' · fee ' + money(p.fee) : ''}</div></span><strong>${money(p.amount)}</strong></div>`).join('')}
    ${(D.payouts || []).map(p => `<div class="row muted"><span>${fmtDate(p.date)} · ${esc(p.via)} payout<div class="note">${esc(p.note || '')}</div></span><span>${money(p.amount)}</span></div>`).join('')}</div>
  <h2>${esc(bank.name || 'Bank')} <span class="pill warn">${bank.status === 'csv' ? 'from CSV' : 'partial'}</span></h2>
  <div class="card">${(bank.transactions || []).map(x => `<div class="row"><span>${fmtDate(x.date)} · ${esc(x.description)}<div class="note">${x.kind === 'owner_draw' ? 'Owner draw (not an expense)' : esc(x.kind)}</div></span><span class="${x.amount < 0 ? 'neg' : 'pos'}">${money(x.amount, true)}</span></div>`).join('')}
    <div class="note">${esc(bank.note || '')}</div>${draws.length ? `<div class="note">Owner draws so far: ${money(sum(draws.map(x => -x.amount)))}</div>` : ''}</div>
  <h2>Coming up</h2>
  <div class="card">${(D.upcoming_costs || []).map(c => `<div class="row"><span>${esc(c.item)}<div class="note">${c.due ? 'Due ' + fmtDate(c.due) : 'Date not set'}${c.note ? ' · ' + esc(c.note) : ''}</div></span><span class="neg">${money(-c.amount)}</span></div>`).join('')}</div>
  ${gaps()}`;
}
function chairCard(r) {
  const c = chair(r);
  return `<h2>Time in the chair</h2><div class="card">
    <div class="hero" style="grid-template-columns:1fr 1fr 1fr">
      <div><div class="lbl">Done · ${RANGES[r].toLowerCase()}</div><div class="big" style="font-size:22px">${c.doneH ? hfmt(c.doneH) : '0'}</div></div>
      <div><div class="lbl">Booked ahead</div><div class="big" style="font-size:22px">${hfmt(c.aheadH)}</div></div>
      <div><div class="lbl">$ / hr done</div><div class="big" style="font-size:22px">${c.perDone == null ? '—' : money(Math.round(c.perDone))}</div></div>
    </div>
    <div class="note">Booked ahead: ${c.ahead.length} session${c.ahead.length === 1 ? '' : 's'} with ${money(sum(c.ahead.map(x => x.paid || 0)))} already paid${c.perAhead != null ? ` (${money(Math.round(c.perAhead))}/hr so far, deposits only)` : ''}.</div>
    <div class="note">${c.unknown} session${c.unknown === 1 ? '' : 's'} with no date or length yet, so not counted. Studio balances aren't recorded, so $/hr will read low until they are.</div>
  </div>
  <h2>Where clients come from</h2><div class="card">
    ${Object.entries(D.booking_sources?.by_platform || {}).map(([k, v]) => `<div class="row"><span>${esc(k)}</span><strong>${v} paid</strong></div>`).join('')}
    <div class="note">${esc(D.booking_sources?.note || '')}</div></div>`;
}
function stripeCard() {
  const s = D.stripe_balance; const f = D.failed_payments || [];
  if (!s && !f.length) return '';
  return `<h2>Stripe</h2><div class="card">${s ? `<div class="row"><span>On the way to your bank<div class="note">${esc(s.detail)}</div></span><strong>${money(s.pending)}</strong></div>` : ''}
    ${f.map(x => `<div class="row"><span class="neg">Failed: ${esc(x.client)} deposit<div class="note">${x.attempts} attempts · ${fmtDate(x.date)} · ${esc(x.via)}</div></span><span class="neg">${money(x.amount)}</span></div>`).join('')}</div>`;
}
function gaps() {
  return `<details class="card"><summary>Where these numbers come from</summary>
    ${D.sources.map(s => `<div class="row"><span><strong>${esc(s.name)}</strong><div class="note">${esc(s.detail)}</div></span></div>`).join('')}
    <h2>Missing</h2>${D.missing.map(m => `<div class="note">• ${esc(m)}</div>`).join('')}</details>`;
}
function vAppts() {
  const f = load('tt.apptf', 'all'); const now = Date.now();
  const list = D.appointments.filter(a => f === 'all' || a.type === f);
  const up = list.filter(a => !a.start || new Date(a.start).getTime() + (a.minutes || 0) * 6e4 >= now).sort((a, b) => (a.start || '9').localeCompare(b.start || '9'));
  const past = list.filter(a => a.start && new Date(a.start).getTime() + (a.minutes || 0) * 6e4 < now).sort((a, b) => b.start.localeCompare(a.start));
  const card = a => `<div class="card"><div class="row"><span><strong>${esc(a.client)}</strong> <span class="pill ${a.type}">${a.type}</span></span><span class="muted small">${esc(a.source)}</span></div>
    <div>${fmtWhen(a.start)}</div><div class="muted small">${esc(a.service)}</div>
    <div class="row"><span>Paid <strong class="pos">${money(a.paid)}</strong></span><span>Balance <strong>${a.balance == null ? 'unknown' : money(a.balance)}</strong>${a.overpaid ? ` <span class="muted small">(${money(a.overpaid)} over list)</span>` : ''}</span></div>
    <div class="note">${esc(a.payment_note || '')}</div>${(a.flags || []).map(x => `<div class="flag">${esc(x)}</div>`).join('')}</div>`;
  const cnt = t => D.appointments.filter(a => t === 'all' || a.type === t).length;
  return `<div class="seg">${['all', 'tattoo', 'piercing'].map(k => `<button data-apptf="${k}" class="${k === f ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)} (${cnt(k)})</button>`).join('')}</div>
    <h2>Upcoming</h2>${up.map(card).join('') || '<div class="card muted">None booked</div>'}
    <h2>Recent</h2>${past.map(card).join('') || '<div class="card muted">None in this window</div>'}`;
}
function vSpend() {
  const marks = bizMarks();
  const cats = groupBy(D.expenses.filter(counted), e => e.category);
  const t = totals('d90');
  return `<div class="hero"><div class="card"><div class="lbl">Business spend · 90 days</div><div class="big">${money(t.spent)}</div></div>
    <div class="card"><div class="lbl">Not sorted yet</div><div class="big muted">${money(t.openAmt)}</div></div></div>
    <h2>By category</h2><div class="card">${cats.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><strong>${money(v)}</strong></div>`).join('') || '<span class="muted">Nothing confirmed</span>'}</div>
    <h2>All purchases</h2>${[...D.expenses].sort((a, b) => b.date.localeCompare(a.date)).map(e => {
      const k = expKey(e); const m = marks[k];
      const ctl = e.status === 'confirmed' ? '<span class="pill">confirmed</span>' :
        `<div class="seg" style="margin:6px 0 0"><button data-biz="${esc(k)}" data-v="1" class="${m === true ? 'on' : ''}">Business</button><button data-biz="${esc(k)}" data-v="0" class="${m === false ? 'on' : ''}">Personal</button></div>`;
      return `<div class="card"><div class="row"><span><strong>${esc(e.vendor)}</strong><div class="note">${fmtDate(e.date)} · ${esc(e.category)}</div></span><strong>${money(e.amount)}</strong></div><div class="note">${esc(e.note || '')}</div>${ctl}</div>`;
    }).join('')}
    <div class="note">Your Business/Personal picks are saved on this phone only. Tell Gojo so the next refresh keeps them.</div>`;
}
function vTodo() {
  const st = load(LS.todo, {}); const custom = load(LS.custom, []);
  const all = [...D.todos, ...custom];
  const groups = [...new Set(all.map(t => t.group))];
  const today = dayStr(new Date());
  const item = t => { const done = st[t.id] ?? !!t.done; const late = !done && t.due && t.due < today;
    return `<label class="todo ${done ? 'done' : ''}"><input type="checkbox" data-todo="${esc(t.id)}" ${done ? 'checked' : ''}><span>${esc(t.text)}${t.due ? `<div class="note ${late ? 'neg' : ''}">${late ? 'Overdue · ' : ''}${fmtDate(t.due)}</div>` : ''}</span>${t.custom ? `<button class="ghost small" data-del="${esc(t.id)}">✕</button>` : ''}</label>`; };
  const ord = (a, b) => ((st[a.id] ?? !!a.done) - (st[b.id] ?? !!b.done)) || (a.due || '9').localeCompare(b.due || '9');
  return groups.map(g => `<h2>${g}</h2><div class="card">${all.filter(t => t.group === g).sort(ord).map(item).join('') || '<span class="muted">Nothing here</span>'}</div>`).join('') +
    `<form class="add" id="addTodo"><select id="tGroup">${groups.map(g => `<option>${g}</option>`).join('')}</select><input id="tText" placeholder="Add a to-do" required><button>Add</button></form>`;
}
const VIEWS = { money: vMoney, appts: vAppts, spend: vSpend, todo: vTodo };
function render() {
  const tab = load(LS.tab, 'money');
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#view').innerHTML = VIEWS[tab]();
  window.scrollTo(0, 0);
}
function start() {
  $('#lock').hidden = true; $('#app').hidden = false;
  $('#asOf').textContent = 'as of ' + new Date(D.as_of).toLocaleString('en-US', {timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) + ' MT';
  render();
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('button, a'); if (!b) return;
  if (b.dataset.tab) { save(LS.tab, b.dataset.tab); render(); }
  else if (b.dataset.goto) { e.preventDefault(); save(LS.tab, b.dataset.goto); render(); }
  else if (b.dataset.range) { save(LS.range, b.dataset.range); render(); }
  else if (b.dataset.apptf) { save('tt.apptf', b.dataset.apptf); render(); }
  else if (b.dataset.biz) { const m = bizMarks(); const v = b.dataset.v === '1'; m[b.dataset.biz] = m[b.dataset.biz] === v ? undefined : v; save(LS.biz, m); render(); }
  else if (b.dataset.del) { e.preventDefault(); save(LS.custom, load(LS.custom, []).filter(t => t.id !== b.dataset.del)); render(); }
});
document.addEventListener('change', e => { if (e.target.dataset.todo) { const st = load(LS.todo, {}); st[e.target.dataset.todo] = e.target.checked; save(LS.todo, st); render(); } });
document.addEventListener('submit', e => {
  if (e.target.id !== 'addTodo') return; e.preventDefault();
  const text = $('#tText').value.trim(); if (!text) return;
  const c = load(LS.custom, []); c.push({id: 'c' + Date.now(), group: $('#tGroup').value, text, custom: true}); save(LS.custom, c); render();
});
$('#unlockForm').addEventListener('submit', async e => {
  e.preventDefault(); $('#lockMsg').textContent = 'Unlocking…';
  try { await unlock($('#pass').value, $('#remember').checked); $('#pass').value = ''; }
  catch (err) { $('#lockMsg').textContent = err.name === 'OperationError' ? 'Wrong passphrase.' : 'Could not load data. ' + err.message; }
});
$('#lockBtn').addEventListener('click', async () => { await keyClear(); D = null; $('#view').innerHTML = ''; $('#app').hidden = true; $('#lock').hidden = false; $('#lockMsg').textContent = 'Locked. Saved key removed from this device.'; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
tryRemembered();
