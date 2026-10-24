'use strict';

/* =========================================================================
   Ledger — a personal finance tracker that lives on your iPhone.
   Everything is stored locally on the device (localStorage). No servers.
   ========================================================================= */

const STORE_KEY = 'ledger.v1';

const CATS = {
  income: [
    ['Salary', '💼'], ['Freelance', '💻'], ['Bonus', '🎁'], ['Dividends', '📈'],
    ['Interest', '🏦'], ['Rental', '🏘️'], ['Refund', '↩️'], ['Other', '✨'],
  ],
  expense: [
    ['Housing', '🏠'], ['Groceries', '🛒'], ['Dining', '🍽️'], ['Transport', '🚗'],
    ['Utilities', '💡'], ['Health', '🩺'], ['Shopping', '🛍️'], ['Fun', '🎬'],
    ['Travel', '✈️'], ['Subscriptions', '🔁'], ['Education', '📚'], ['Personal', '💇'],
    ['Gifts', '🎀'], ['Insurance', '🛡️'], ['Taxes', '🧾'], ['Other', '📦'],
  ],
};

const ACCOUNT_KINDS = {
  cash: ['Bank & cash', '🏦'],
  etf: ['Index funds / ETFs', '🧺'],
  stocks: ['Stocks', '📊'],
  retirement: ['Retirement', '🏖️'],
  bonds: ['Bonds', '📜'],
  crypto: ['Crypto', '🪙'],
  realestate: ['Real estate', '🏘️'],
  other: ['Other asset', '💎'],
  debt: ['Debt / loan', '💳'],
};
const isInvestKind = (k) => k !== 'cash' && k !== 'debt';

const FREQS = { none: 'Never', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' };

const CURRENCIES = ['USD', 'EUR', 'GBP', 'BRL', 'CAD', 'AUD', 'CHF', 'JPY', 'MXN', 'INR', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'NZD', 'SGD', 'HKD', 'ZAR', 'KRW'];

const TYPE_META = {
  income: { label: 'Income', color: '--s-income', sign: 1 },
  expense: { label: 'Expense', color: '--s-expense', sign: -1 },
  invest: { label: 'Invest', color: '--s-invest', sign: -1 },
};

/* ---------- Tiny helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const monthKey = (s) => s.slice(0, 7);
const ymKey = (y, m) => `${y}-${pad(m + 1)}`;
const thisMonth = () => monthKey(today());
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sum = (arr, f = (x) => x) => arr.reduce((a, x) => a + f(x), 0);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const parseAmount = (s) => { const n = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

function addMonths(key, n) {
  let [y, m] = key.split('-').map(Number);
  m = m - 1 + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return ymKey(y, m);
}
function monthName(key, style = 'long') {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const sameYear = y === new Date().getFullYear();
  return d.toLocaleDateString(undefined, style === 'short' ? { month: 'short' } : { month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}
function daysInMonth(key) { const [y, m] = key.split('-').map(Number); return new Date(y, m, 0).getDate(); }
function prettyDate(s) {
  const t = today();
  if (s === t) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (s === iso(y)) return 'Yesterday';
  const d = parseISO(s);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
}
function guessCurrency() {
  try {
    const loc = (navigator.language || 'en-US');
    const region = (loc.split('-')[1] || '').toUpperCase();
    const map = { US: 'USD', BR: 'BRL', GB: 'GBP', CA: 'CAD', AU: 'AUD', CH: 'CHF', JP: 'JPY', MX: 'MXN', IN: 'INR', CN: 'CNY', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', NZ: 'NZD', SG: 'SGD', HK: 'HKD', ZA: 'ZAR', KR: 'KRW' };
    const euro = ['PT', 'ES', 'FR', 'DE', 'IT', 'NL', 'BE', 'IE', 'AT', 'FI', 'GR', 'LU', 'SK', 'SI', 'EE', 'LV', 'LT', 'MT', 'CY', 'HR'];
    if (map[region]) return map[region];
    if (euro.includes(region)) return 'EUR';
    if (loc.startsWith('pt')) return 'BRL';
  } catch (e) { /* ignore */ }
  return 'USD';
}

/* ---------- State ---------- */
function defaultState() {
  return {
    version: 1,
    settings: { currency: guessCurrency(), name: '', privacy: false, theme: 'auto', onboarded: false, calc: { rate: 7, years: 20, monthly: null } },
    transactions: [],
    recurring: [],
    accounts: [],
    budgets: {},
    goals: [],
    nwHistory: {},
  };
}
let state = load();
const ui = { tab: 'home', month: thisMonth(), filter: 'all', query: '', tables: {} };

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const d = defaultState();
    return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}), calc: { ...d.settings.calc, ...((s.settings || {}).calc || {}) } } };
  } catch (e) {
    console.warn('Could not load data', e);
    return defaultState();
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('⚠️ Could not save — storage full?'); }
}

/* ---------- Money formatting ---------- */
const fmtCache = {};
function nf(key, opts) {
  const k = state.settings.currency + key;
  if (!fmtCache[k]) {
    try { fmtCache[k] = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency, ...opts }); }
    catch (e) { fmtCache[k] = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', ...opts }); }
  }
  return fmtCache[k];
}
const money = (n) => nf('c', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const money0 = (n) => nf('0', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const moneyC = (n) => Math.abs(n) >= 10000 ? nf('k', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : money0(n);
const pct = (n, d = 0) => `${(n * 100).toFixed(d)}%`;
const currencySymbol = () => { try { return nf('0', { maximumFractionDigits: 0 }).formatToParts(0).find((p) => p.type === 'currency').value; } catch (e) { return '$'; } };

/* ---------- Domain logic ---------- */
function catEmoji(type, cat) {
  if (type === 'invest') return '📈';
  const f = (CATS[type] || []).find((c) => c[0] === cat);
  return f ? f[1] : '•';
}
function accountById(id) { return state.accounts.find((a) => a.id === id); }
function txLabel(t) {
  if (t.type === 'invest') { const a = accountById(t.accountId); return a ? a.name : 'Investment'; }
  return t.category;
}

function applyTxn(t, sign) {
  if (t.type !== 'invest' || !t.accountId) return;
  const a = accountById(t.accountId);
  if (!a) return;
  a.value = round2(a.value + sign * t.amount);
  a.basis = round2((a.basis || 0) + sign * t.amount);
  a.updated = today();
}
const round2 = (n) => Math.round(n * 100) / 100;

function addTxn(t) { state.transactions.push(t); applyTxn(t, +1); }
function removeTxn(id) {
  const i = state.transactions.findIndex((t) => t.id === id);
  if (i < 0) return;
  applyTxn(state.transactions[i], -1);
  state.transactions.splice(i, 1);
}

function txInMonth(key) { return state.transactions.filter((t) => monthKey(t.date) === key); }
function monthTotals(key) {
  const r = { income: 0, expense: 0, invest: 0 };
  for (const t of state.transactions) if (monthKey(t.date) === key) r[t.type] += t.amount;
  r.kept = r.income - r.expense;
  r.left = r.income - r.expense - r.invest;
  r.saveRate = r.income > 0 ? r.kept / r.income : 0;
  r.investRate = r.income > 0 ? r.invest / r.income : 0;
  return r;
}
function avgMonthly(type, months = 3, endKey = thisMonth()) {
  // Average over the previous full months (excluding the current one), ignoring months before any data.
  const first = state.transactions.reduce((m, t) => (m && m < t.date ? m : t.date), null);
  if (!first) return 0;
  let total = 0, count = 0;
  for (let i = 1; i <= months; i++) {
    const k = addMonths(endKey, -i);
    if (k < monthKey(first)) break;
    total += monthTotals(k)[type];
    count++;
  }
  if (!count) return monthTotals(endKey)[type];
  return total / count;
}
function netWorth() { return sum(state.accounts, (a) => (a.kind === 'debt' ? -Math.abs(a.value) : a.value)); }
function portfolio() {
  const inv = state.accounts.filter((a) => isInvestKind(a.kind));
  const value = sum(inv, (a) => a.value);
  const basis = sum(inv, (a) => a.basis || 0);
  return { value, basis, gain: value - basis, gainPct: basis > 0 ? (value - basis) / basis : 0, accounts: inv };
}
function cashTotal() { return sum(state.accounts.filter((a) => a.kind === 'cash'), (a) => a.value); }
function snapshot() {
  state.nwHistory[today()] = round2(netWorth());
}
function nwSeries() {
  return Object.entries(state.nwHistory).sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
function nwAt(dateStr) {
  // last known snapshot on or before date
  let v = null;
  for (const [d, val] of nwSeries()) { if (d <= dateStr) v = val; else break; }
  return v;
}

/* Recurring */
function advanceDate(s, freq, anchor) {
  const d = parseISO(s);
  if (freq === 'weekly') { d.setDate(d.getDate() + 7); return iso(d); }
  if (freq === 'biweekly') { d.setDate(d.getDate() + 14); return iso(d); }
  const months = freq === 'yearly' ? 12 : 1;
  const y = d.getFullYear(), m = d.getMonth() + months;
  const last = new Date(y, m + 1, 0).getDate();
  return iso(new Date(y, m, Math.min(anchor || d.getDate(), last)));
}
function processRecurring() {
  const t = today();
  let added = 0;
  for (const r of state.recurring) {
    let guard = 0;
    while (r.next <= t && guard++ < 400) {
      addTxn({ id: uid(), type: r.type, amount: r.amount, category: r.category, accountId: r.accountId, note: r.note, date: r.next, recurringId: r.id });
      r.next = advanceDate(r.next, r.freq, r.anchor);
      added++;
    }
  }
  if (added) { snapshot(); save(); }
  return added;
}
function monthlyEquivalent(r) {
  return r.amount * ({ weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, yearly: 1 / 12 }[r.freq] || 1);
}

/* ---------- Charts (inline SVG) ---------- */
const charts = new Map();
let chartSeq = 0;
function chartW() { return Math.max(260, Math.min(document.documentElement.clientWidth, 640) - 64); }
function niceMax(v) {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
}
function roundTopRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function tipRow(color, label, value) {
  return `<div class="tt-row"><span><i class="dot" style="background:var(${color})"></i>${esc(label)}</span><span class="amt">${esc(value)}</span></div>`;
}

function barChart(groups, series, height = 190) {
  const W = chartW(), H = height, padL = 44, padB = 22, padT = 8;
  const ih = H - padB - padT, iw = W - padL;
  const max = niceMax(Math.max(1, ...groups.flatMap((g) => g.values)));
  const n = series.length, gw = iw / groups.length;
  const bw = Math.max(5, Math.min(16, (gw * 0.72 - (n - 1) * 2) / n));
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Monthly cash flow chart">`;
  s += '<g class="amt">';
  for (let i = 0; i <= 4; i++) {
    const y = padT + ih - (ih * i) / 4;
    s += `<line class="grid" x1="${padL}" x2="${W}" y1="${y}" y2="${y}" ${i === 0 ? 'style="stroke:var(--text-3);opacity:.5"' : ''}/>`;
    s += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end">${esc(moneyC((max * i) / 4))}</text>`;
  }
  s += '</g>';
  groups.forEach((g, gi) => {
    const cx = padL + gw * gi + gw / 2;
    const totalW = n * bw + (n - 1) * 2;
    const x0 = cx - totalW / 2;
    g.values.forEach((v, si) => {
      const h = (ih * v) / max;
      if (h > 0.5) s += `<path d="${roundTopRect(x0 + si * (bw + 2), padT + ih - h, bw, h, 4)}" fill="var(${series[si].color})"${g.dim ? ' opacity=".55"' : ''}/>`;
    });
    s += `<text x="${cx}" y="${H - 6}" text-anchor="middle" ${g.active ? 'style="fill:var(--text);font-weight:600"' : ''}>${esc(g.label)}</text>`;
    const tip = `<b>${esc(g.title)}</b>` + series.map((se, si) => tipRow(se.color, se.name, money0(g.values[si]))).join('');
    s += `<rect class="hit" x="${padL + gw * gi}" y="0" width="${gw}" height="${H}" data-tip="${esc(tip)}"${g.key ? ` data-month="${g.key}"` : ''}/>`;
  });
  return s + '</svg>';
}

function arcPath(cx, cy, R, r, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad, a) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  return `M${p(R, a0)}A${R},${R} 0 ${large} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large} 0 ${p(r, a0)}Z`;
}
function donut(items, centerValue, centerLabel, size = 140) {
  const total = sum(items, (i) => i.value);
  const cx = size / 2, cy = size / 2, R = size / 2 - 2, r = R * 0.66;
  let s = `<svg class="chart" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(centerLabel)} breakdown">`;
  if (total <= 0) {
    s += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="var(--track)" stroke-width="${R - r}"/>`;
  } else if (items.length === 1) {
    s += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="var(${items[0].color})" stroke-width="${R - r}" data-tip="${esc(`<b>${esc(items[0].label)}</b>` + tipRow(items[0].color, '100%', money0(items[0].value)))}"/>`;
  } else {
    let a = -Math.PI / 2;
    for (const it of items) {
      const a1 = a + (it.value / total) * Math.PI * 2;
      const tip = `<b>${esc(it.label)}</b>` + tipRow(it.color, pct(it.value / total), money0(it.value));
      s += `<path d="${arcPath(cx, cy, R, r, a, a1)}" fill="var(${it.color})" stroke="var(--card)" stroke-width="2" stroke-linejoin="round" data-tip="${esc(tip)}"/>`;
      a = a1;
    }
  }
  s += `<text class="donut-center-v amt" x="${cx}" y="${cy + 2}" text-anchor="middle">${esc(centerValue)}</text>`;
  s += `<text class="donut-center-l" x="${cx}" y="${cy + 18}" text-anchor="middle">${esc(centerLabel)}</text>`;
  return s + '</svg>';
}

/** series: [{name, color, values[]}]; labels: x labels; tips(i) → html */
function lineChart(labels, series, tips, { height = 180, area = true, xTicks = 4 } = {}) {
  const id = `c${++chartSeq}`;
  const W = chartW(), H = height, padL = 46, padR = 6, padB = 22, padT = 10;
  const iw = W - padL - padR, ih = H - padT - padB;
  const all = series.flatMap((s) => s.values);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (lo > 0 && lo / (hi || 1) > 0.5) lo = lo * 0.9; else lo = Math.min(0, lo);
  hi = niceMax(hi <= lo ? lo + 1 : hi);
  const n = labels.length;
  const X = (i) => padL + (n <= 1 ? iw / 2 : (iw * i) / (n - 1));
  const Y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" data-cid="${id}" style="touch-action:pan-y" role="img" aria-label="Line chart">`;
  s += `<defs><linearGradient id="${id}g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(${series[0].color})" stop-opacity=".22"/><stop offset="1" stop-color="var(${series[0].color})" stop-opacity="0"/></linearGradient></defs>`;
  s += '<g class="amt">';
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    const y = Y(v);
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    s += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end">${esc(moneyC(v))}</text>`;
  }
  s += '</g>';
  const step = Math.max(1, Math.ceil((n - 1) / xTicks));
  for (let i = 0; i < n; i += step) s += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(labels[i])}</text>`;
  if (n > 1 && (n - 1) % step !== 0) s += `<text x="${X(n - 1)}" y="${H - 6}" text-anchor="end">${esc(labels[n - 1])}</text>`;
  series.forEach((se, si) => {
    const pts = se.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
    if (si === 0 && area && n > 1) s += `<path d="M${pts.join('L')}L${X(n - 1)},${padT + ih}L${X(0)},${padT + ih}Z" fill="url(#${id}g)"/>`;
    s += `<path d="M${pts.join('L')}" fill="none" stroke="var(${se.color})" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" ${se.dashed ? 'stroke-dasharray="4 4"' : ''}/>`;
  });
  // end point marker on primary series
  const last = series[0].values[n - 1];
  s += `<circle cx="${X(n - 1)}" cy="${Y(last)}" r="4" fill="var(${series[0].color})" stroke="var(--card)" stroke-width="2"/>`;
  // crosshair layer
  s += `<g class="xh" style="display:none"><line x1="0" x2="0" y1="${padT}" y2="${padT + ih}" stroke="var(--text-3)" stroke-width="1"/>`;
  series.forEach((se) => { s += `<circle r="4.5" fill="var(${se.color})" stroke="var(--card)" stroke-width="2"/>`; });
  s += '</g>';
  s += `<rect class="hit" x="${padL}" y="0" width="${iw}" height="${H}"/>`;
  charts.set(id, { X, Y, n, padL, iw, W, series, tips });
  return s + '</svg>';
}

function sparkline(values, w = 120, h = 44) {
  if (values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values);
  const X = (i) => (w * i) / (values.length - 1);
  const Y = (v) => (hi === lo ? h / 2 : h - 4 - ((v - lo) / (hi - lo)) * (h - 8));
  const d = values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('L');
  return `<svg class="hero-spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="M${d}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function ring(frac, color, size = 52, stroke = 6, label = '') {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const f = clamp(frac, 0, 1);
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(${color})" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c * f} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" style="font-size:12px;font-weight:700;fill:var(--text)">${esc(label)}</text>
  </svg>`;
}

/* Tooltip handling */
const tipEl = $('#tooltip');
let tipTimer;
function showTip(html, x, y) {
  tipEl.innerHTML = html;
  tipEl.hidden = false;
  const r = tipEl.getBoundingClientRect();
  let left = x - r.width / 2, top = y - r.height - 14;
  left = clamp(left, 8, window.innerWidth - r.width - 8);
  if (top < 60) top = y + 18;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(hideTip, 4000);
}
function hideTip() {
  tipEl.hidden = true;
  $$('.xh').forEach((g) => (g.style.display = 'none'));
}
function lineHover(svg, clientX) {
  const c = charts.get(svg.dataset.cid);
  if (!c) return;
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) * c.W) / rect.width;
  const i = clamp(Math.round(((x - c.padL) / c.iw) * (c.n - 1)), 0, c.n - 1);
  const g = $('.xh', svg);
  g.style.display = '';
  const px = c.X(i);
  const line = $('line', g);
  line.setAttribute('x1', px); line.setAttribute('x2', px);
  $$('circle', g).forEach((dot, si) => { dot.setAttribute('cx', px); dot.setAttribute('cy', c.Y(c.series[si].values[i])); });
  const sx = rect.left + (px / c.W) * rect.width;
  const sy = rect.top + (c.Y(c.series[0].values[i]) / c.W) * rect.width;
  showTip(c.tips(i), sx, sy);
}
document.addEventListener('pointerdown', (e) => {
  const svg = e.target.closest('svg[data-cid]');
  if (svg) { lineHover(svg, e.clientX); return; }
  const t = e.target.closest('[data-tip]');
  if (t) { const r = t.getBoundingClientRect(); showTip(t.dataset.tip, e.clientX || r.left + r.width / 2, Math.min(e.clientY, r.top + r.height / 2) || r.top); return; }
  hideTip();
});
document.addEventListener('pointermove', (e) => {
  const svg = e.target.closest('svg[data-cid]');
  if (svg) lineHover(svg, e.clientX);
  else if (e.pointerType === 'mouse') {
    const t = e.target.closest('[data-tip]');
    if (t) showTip(t.dataset.tip, e.clientX, e.clientY); else hideTip();
  }
});
window.addEventListener('scroll', () => {
  hideTip();
  $('#topbar').classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });

/* ---------- Generic UI pieces ---------- */
function txRow(t, { showDate = false } = {}) {
  const meta = TYPE_META[t.type];
  const sub = [t.note, showDate ? prettyDate(t.date) : null, t.recurringId ? '↻ recurring' : null].filter(Boolean).join(' · ') || meta.label;
  return `<button class="row" data-action="edit-tx" data-id="${t.id}">
    <div class="row-icon" style="box-shadow:inset 0 0 0 1.5px var(${meta.color})">${catEmoji(t.type, t.category)}</div>
    <div class="row-main"><div class="row-title">${esc(txLabel(t))}</div><div class="row-sub">${esc(sub)}</div></div>
    <div class="row-end"><div class="row-amt amt ${t.type === 'income' ? 'pos' : ''}">${t.type === 'income' ? '' : '−'}${esc(money(t.amount))}</div>
      <div class="row-meta">${meta.label}</div></div>
  </button>`;
}
function legend(items) {
  return `<div class="legend">${items.map((i) => `<span><i class="dot" style="background:var(${i.color})"></i>${esc(i.name)}</span>`).join('')}</div>`;
}
function tableToggle(key, headers, rows) {
  const open = ui.tables[key];
  return `<button class="table-toggle" data-action="toggle-table" data-key="${key}">${open ? 'Hide table' : 'Show as table'}</button>` +
    (open ? `<table class="data amt"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '');
}
function emptyState(emoji, text, btn) {
  return `<div class="card empty"><div class="big">${emoji}</div><div>${text}</div>${btn || ''}</div>`;
}
function signed(n, f = money0) { return (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n)); }

/* ---------- Views ---------- */
function render() {
  charts.clear();
  hideTip();
  document.body.classList.toggle('privacy', !!state.settings.privacy);
  applyTheme();
  $('#month-label').textContent = monthName(ui.month);
  $('#btn-next').style.visibility = ui.month >= thisMonth() ? 'hidden' : 'visible';
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === ui.tab));
  const view = $('#view');
  const fns = { home: renderHome, activity: renderActivity, invest: renderInvest, plan: renderPlan };
  view.innerHTML = `<div class="fade-in">${fns[ui.tab]()}</div>`;
  $('#month-nav').style.visibility = ui.tab === 'invest' ? 'hidden' : 'visible';
}

function renderWelcome() {
  return `<div class="welcome">
    <img class="logo" src="icons/icon-192.png" alt="">
    <h1>Welcome to Ledger</h1>
    <p>See what you make, where it goes, and how your investments grow. Your data stays on this iPhone.</p>
  </div>
  <div class="card">
    <div class="feature"><div class="e">💸</div><div><b>Income, spending & investing</b><span>Log in seconds. Set repeats for salary, rent and subscriptions.</span></div></div>
    <div class="feature"><div class="e">📊</div><div><b>Savings & investing rate</b><span>See what share of each paycheck you keep and put to work.</span></div></div>
    <div class="feature"><div class="e">📈</div><div><b>Portfolio & net worth</b><span>Track accounts, gains and allocation over time.</span></div></div>
    <div class="feature"><div class="e">🎯</div><div><b>Budgets, goals & projections</b><span>Plan ahead with a compound-growth and financial-independence calculator.</span></div></div>
  </div>
  <button class="btn" data-action="start-fresh">Start fresh</button>
  <button class="btn secondary" data-action="load-demo">Explore with sample data</button>`;
}

function renderHome() {
  if (!state.settings.onboarded && !state.transactions.length && !state.accounts.length) return renderWelcome();
  const k = ui.month;
  const m = monthTotals(k);
  const prev = monthTotals(addMonths(k, -1));
  const nw = netWorth();
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = state.settings.name ? `, ${esc(state.settings.name)}` : '';

  // Net worth change this month
  const ser = nwSeries();
  const startOfMonthNW = nwAt(iso(new Date(new Date().getFullYear(), new Date().getMonth(), 0)));
  const nwDelta = startOfMonthNW != null ? nw - startOfMonthNW : null;
  const pf = portfolio();

  const delta = (cur, before, goodUp = true) => {
    if (!before) return '<div class="stat-delta">—</div>';
    const d = (cur - before) / before;
    const arrow = d >= 0 ? '▲' : '▼';
    return `<div class="stat-delta">${arrow} ${pct(Math.abs(d))} vs ${monthName(addMonths(k, -1), 'short')}</div>`;
  };

  let h = `<h1 class="page-title">${greet}${name}</h1><p class="page-sub">Here's ${k === thisMonth() ? 'this month' : monthName(k)} at a glance.</p>`;

  h += `<div class="hero">
    <div class="hero-label">Net worth</div>
    <div class="hero-value amt">${esc(money0(nw))}</div>
    <div class="hero-meta">
      ${nwDelta != null ? `<span class="pill amt">${nwDelta >= 0 ? '▲' : '▼'} ${esc(money0(Math.abs(nwDelta)))} this month</span>` : ''}
      ${pf.basis > 0 ? `<span class="pill amt">Portfolio ${pf.gain >= 0 ? '+' : '−'}${pct(Math.abs(pf.gainPct), 1)}</span>` : ''}
      ${!state.accounts.length ? '<span class="pill">Add accounts in Invest →</span>' : ''}
    </div>
    ${sparkline(ser.slice(-30).map((x) => x[1]))}
  </div>`;

  h += `<div class="stats">
    <div class="stat"><div class="stat-label"><i class="dot" style="background:var(--s-income)"></i>Earned</div><div class="stat-value amt">${esc(moneyC(m.income))}</div>${delta(m.income, prev.income)}</div>
    <div class="stat"><div class="stat-label"><i class="dot" style="background:var(--s-expense)"></i>Spent</div><div class="stat-value amt">${esc(moneyC(m.expense))}</div>${delta(m.expense, prev.expense)}</div>
    <div class="stat"><div class="stat-label"><i class="dot" style="background:var(--s-invest)"></i>Invested</div><div class="stat-value amt">${esc(moneyC(m.invest))}</div>${delta(m.invest, prev.invest)}</div>
  </div>`;

  // Rates
  h += `<div class="card" style="margin-top:12px"><div class="rates">
    <div><div class="card-title">Savings rate</div><div class="rate-num">${m.income ? pct(m.saveRate) : '—'}</div>
      <div class="rate-cap">of income kept</div><div class="bar"><i style="width:${clamp(m.saveRate, 0, 1) * 100}%;background:var(--s-income)"></i></div></div>
    <div><div class="card-title">Investing rate</div><div class="rate-num">${m.income ? pct(m.investRate) : '—'}</div>
      <div class="rate-cap">of income invested</div><div class="bar"><i style="width:${clamp(m.investRate, 0, 1) * 100}%;background:var(--s-invest)"></i></div></div>
  </div>
  <div class="rate-cap" style="margin-top:12px">Left over after investing: <b class="amt" style="color:var(--text)">${esc(signed(m.left))}</b></div>
  </div>`;

  // Cash flow chart: 6 months
  const series = [
    { name: 'Earned', color: '--s-income' },
    { name: 'Spent', color: '--s-expense' },
    { name: 'Invested', color: '--s-invest' },
  ];
  const groups = [];
  for (let i = 5; i >= 0; i--) {
    const key = addMonths(k, -i);
    const t = monthTotals(key);
    groups.push({ key, label: monthName(key, 'short'), title: monthName(key), values: [t.income, t.expense, t.invest], active: key === k });
  }
  h += `<div class="section-head"><h2>Cash flow</h2><span class="rate-cap">Last 6 months</span></div>
    <div class="card">${legend(series)}${barChart(groups, series)}
    ${tableToggle('cash', ['Month', 'Earned', 'Spent', 'Invested'], groups.map((g) => [g.label, money0(g.values[0]), money0(g.values[1]), money0(g.values[2])]))}</div>`;

  // Spending by category
  h += `<div class="section-head"><h2>Spending</h2><button class="link" data-action="go" data-tab="activity" data-filter="expense">See all</button></div>`;
  h += spendingCard(k);

  // Insights
  const ins = insights(k);
  if (ins.length) {
    h += `<div class="section-head"><h2>Insights</h2></div><div class="card" style="padding-top:4px;padding-bottom:4px">${ins.map((i) => `<div class="insight"><div class="insight-ico">${i.icon}</div><div><p>${i.text}</p>${i.sub ? `<small>${i.sub}</small>` : ''}</div></div>`).join('')}</div>`;
  }

  // Recent
  const recent = [...state.transactions].sort(byDateDesc).slice(0, 5);
  h += `<div class="section-head"><h2>Recent</h2><button class="link" data-action="go" data-tab="activity">See all</button></div>`;
  h += recent.length ? `<div class="list">${recent.map((t) => txRow(t, { showDate: true })).join('')}</div>`
    : emptyState('🧾', 'No transactions yet. Tap <b>+</b> to add your first one.');
  return h;
}
const byDateDesc = (a, b) => (a.date === b.date ? (b.created || 0) - (a.created || 0) : a.date < b.date ? 1 : -1);

function categoryBreakdown(key) {
  const by = {};
  for (const t of txInMonth(key)) if (t.type === 'expense') by[t.category] = (by[t.category] || 0) + t.amount;
  const sorted = Object.entries(by).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7);
  const items = top.map(([c, v], i) => ({ label: `${catEmoji('expense', c)} ${c}`, cat: c, value: v, color: `--c${i + 1}` }));
  if (rest.length) items.push({ label: 'Other categories', value: sum(rest, (r) => r[1]), color: '--text-3' });
  return items;
}
function spendingCard(k) {
  const items = categoryBreakdown(k);
  const total = sum(items, (i) => i.value);
  if (!total) return emptyState('🛒', 'No spending recorded this month.');
  return `<div class="card"><div class="donut-wrap">${donut(items, moneyC(total), 'spent')}
    <div class="cat-list">${items.map((i) => `<div class="cat-item"><i class="dot" style="background:var(${i.color})"></i><span class="name">${esc(i.label)}</span><span class="val amt">${pct(i.value / total)}</span></div>`).join('')}</div></div>
    ${tableToggle('spend', ['Category', 'Amount', 'Share'], items.map((i) => [i.label, money0(i.value), pct(i.value / total, 1)]))}</div>`;
}

function insights(k) {
  const out = [];
  const m = monthTotals(k);
  const prev = monthTotals(addMonths(k, -1));
  const isCurrent = k === thisMonth();

  if (m.income > 0) {
    const sr = m.saveRate;
    let text = `You kept <b>${pct(sr)}</b> of your income${isCurrent ? ' so far' : ''}.`;
    if (prev.income > 0) {
      const d = sr - prev.saveRate;
      if (Math.abs(d) >= 0.02) text += ` That's ${d > 0 ? 'up' : 'down'} ${Math.abs(d * 100).toFixed(0)} points from last month.`;
    }
    out.push({ icon: sr >= 0.2 ? '🌱' : sr >= 0 ? '🪴' : '⚠️', text, sub: sr >= 0.2 ? 'A 20%+ savings rate is a strong habit.' : 'Aiming for 20% is a common rule of thumb (50/30/20).' });
  }
  if (m.income > 0 && m.invest === 0 && state.accounts.some((a) => isInvestKind(a.kind))) {
    out.push({ icon: '🧭', text: 'Nothing invested yet this month.', sub: 'Paying yourself first, right after payday, makes it automatic.' });
  } else if (m.investRate >= 0.15) {
    out.push({ icon: '🚀', text: `You invested <b>${pct(m.investRate)}</b> of your income.`, sub: 'At 15%+ you are on a strong long-term track.' });
  }

  // Spending pace (current month)
  if (isCurrent && m.expense > 0) {
    const day = new Date().getDate();
    const dim = daysInMonth(k);
    const projected = (m.expense / day) * dim;
    const avg = avgMonthly('expense', 3, k);
    let sub = '';
    if (avg > 0) sub = projected > avg * 1.1 ? `That's ${pct(projected / avg - 1)} above your 3-month average.` : projected < avg * 0.9 ? `That's ${pct(1 - projected / avg)} below your 3-month average. Nice.` : 'In line with your recent months.';
    out.push({ icon: '📅', text: `At this pace you'll spend about <b class="amt">${esc(money0(projected))}</b> this month.`, sub });
  }

  // Top category vs average
  const items = categoryBreakdown(k);
  if (items.length && items[0].cat) {
    const top = items[0];
    const tot = sum(items, (i) => i.value);
    let prevSum = 0, cnt = 0;
    for (let i = 1; i <= 3; i++) {
      const pk = addMonths(k, -i);
      const v = sum(txInMonth(pk).filter((t) => t.type === 'expense' && t.category === top.cat), (t) => t.amount);
      if (txInMonth(pk).length) { prevSum += v; cnt++; }
    }
    const avg = cnt ? prevSum / cnt : 0;
    let sub = '';
    if (avg > 0 && top.value > avg * 1.2) sub = `That's ${pct(top.value / avg - 1)} more than you usually spend on it.`;
    out.push({ icon: catEmoji('expense', top.cat), text: `<b>${esc(top.cat)}</b> is your biggest expense: ${pct(top.value / tot)} of spending.`, sub });
  }

  // Budgets
  const over = Object.entries(state.budgets).filter(([c, b]) => b > 0 && sum(txInMonth(k).filter((t) => t.type === 'expense' && t.category === c), (t) => t.amount) > b);
  if (over.length) out.push({ icon: '🚨', text: `Over budget in <b>${over.map((o) => esc(o[0])).join(', ')}</b>.`, sub: 'Check the Plan tab to adjust.' });

  // Emergency fund
  const cash = cashTotal();
  const avgExp = avgMonthly('expense', 3, thisMonth());
  if (cash > 0 && avgExp > 0) {
    const months = cash / avgExp;
    out.push({ icon: months >= 6 ? '🛟' : months >= 3 ? '🧯' : '⚠️', text: `Your cash covers <b>${months.toFixed(1)} months</b> of expenses.`, sub: months >= 6 ? 'Solid safety net: consider investing the excess.' : 'Many people aim for 3 to 6 months as an emergency fund.' });
  }

  // Subscriptions
  const subs = state.recurring.filter((r) => r.type === 'expense' && r.category === 'Subscriptions');
  if (subs.length) {
    const mo = sum(subs, monthlyEquivalent);
    out.push({ icon: '🔁', text: `Subscriptions cost you <b class="amt">${esc(money0(mo))}/mo</b>, which is <b class="amt">${esc(money0(mo * 12))}</b> a year.`, sub: 'Worth a review: cancel what you don\'t use.' });
  }

  // Dividends / passive income
  const passive = sum(txInMonth(k).filter((t) => t.type === 'income' && ['Dividends', 'Interest', 'Rental'].includes(t.category)), (t) => t.amount);
  if (passive > 0 && avgExp > 0) out.push({ icon: '🌳', text: `Passive income of <b class="amt">${esc(money0(passive))}</b> covered ${pct(passive / avgExp, 1)} of a month's expenses.`, sub: 'This is the number that eventually sets you free.' });

  return out;
}

function renderActivity() {
  let h = `<h1 class="page-title">Activity</h1>`;
  h += `<input class="search" id="search" type="search" placeholder="Search all transactions" value="${esc(ui.query)}" autocomplete="off">`;
  h += `<div class="chips">${[['all', 'All'], ['income', 'Income'], ['expense', 'Expenses'], ['invest', 'Investments']].map(([k, l]) => `<button class="chip ${ui.filter === k ? 'active' : ''}" data-action="filter" data-filter="${k}">${l}</button>`).join('')}</div>`;
  return h + `<div id="act-results">${activityResults()}</div>`;
}
function activityResults() {
  const q = ui.query.trim().toLowerCase();
  let h = '';
  let list = q
    ? state.transactions.filter((t) => [txLabel(t), t.note, t.category, String(t.amount)].join(' ').toLowerCase().includes(q))
    : txInMonth(ui.month);
  if (ui.filter !== 'all') list = list.filter((t) => t.type === ui.filter);
  list.sort(byDateDesc);
  const m = monthTotals(ui.month);
  if (!q) {
    h += `<div class="stats" style="margin-top:0;margin-bottom:6px">
      <div class="stat"><div class="stat-label"><i class="dot" style="background:var(--s-income)"></i>In</div><div class="stat-value amt">${esc(moneyC(m.income))}</div></div>
      <div class="stat"><div class="stat-label"><i class="dot" style="background:var(--s-expense)"></i>Out</div><div class="stat-value amt">${esc(moneyC(m.expense))}</div></div>
      <div class="stat"><div class="stat-label"><i class="dot" style="background:var(--s-invest)"></i>Invested</div><div class="stat-value amt">${esc(moneyC(m.invest))}</div></div>
    </div>`;
  }
  if (!list.length) return h + emptyState(q ? '🔍' : '🗓️', q ? 'No matches.' : `Nothing here for ${monthName(ui.month)}.`);
  const byDate = {};
  for (const t of list) (byDate[t.date] = byDate[t.date] || []).push(t);
  for (const [d, txs] of Object.entries(byDate)) {
    const net = sum(txs, (t) => (t.type === 'income' ? t.amount : -t.amount));
    h += `<div class="date-head"><span>${esc(prettyDate(d))}</span><span class="amt">${esc(signed(net, money))}</span></div>`;
    h += `<div class="list">${txs.map((t) => txRow(t)).join('')}</div>`;
  }
  return h;
}

function renderInvest() {
  const pf = portfolio();
  const nw = netWorth();
  let h = `<h1 class="page-title">Invest</h1><p class="page-sub">Your portfolio and net worth.</p>`;
  if (!state.accounts.length) {
    return h + emptyState('📈', 'Add your accounts (brokerage, retirement, crypto, bank, loans) to track your portfolio and net worth.',
      '<button class="btn" data-action="new-account" style="margin-top:14px">Add an account</button>');
  }

  h += `<div class="hero" style="background:linear-gradient(135deg,#0f5e45 0%,#1a8f68 55%,#2fb98a 100%)">
    <div class="hero-label">Portfolio value</div>
    <div class="hero-value amt">${esc(money0(pf.value))}</div>
    <div class="hero-meta">
      <span class="pill amt">Invested ${esc(money0(pf.basis))}</span>
      <span class="pill amt">${pf.gain >= 0 ? '▲' : '▼'} ${esc(money0(Math.abs(pf.gain)))} (${pct(Math.abs(pf.gainPct), 1)})</span>
    </div>
  </div>`;

  // Contributions this year
  const y = String(new Date().getFullYear());
  const ytdInvest = sum(state.transactions.filter((t) => t.type === 'invest' && t.date.startsWith(y)), (t) => t.amount);
  const ytdIncome = sum(state.transactions.filter((t) => t.type === 'income' && t.date.startsWith(y)), (t) => t.amount);
  const ytdPassive = sum(state.transactions.filter((t) => t.type === 'income' && ['Dividends', 'Interest'].includes(t.category) && t.date.startsWith(y)), (t) => t.amount);
  h += `<div class="stats">
    <div class="stat"><div class="stat-label">Net worth</div><div class="stat-value amt">${esc(moneyC(nw))}</div></div>
    <div class="stat"><div class="stat-label">Invested ${y}</div><div class="stat-value amt">${esc(moneyC(ytdInvest))}</div><div class="stat-delta">${ytdIncome ? pct(ytdInvest / ytdIncome) + ' of income' : '—'}</div></div>
    <div class="stat"><div class="stat-label">Dividends ${y}</div><div class="stat-value amt">${esc(moneyC(ytdPassive))}</div></div>
  </div>`;

  // Net worth over time
  const ser = nwSeries();
  if (ser.length >= 2) {
    const labels = ser.map(([d]) => parseISO(d).toLocaleDateString(undefined, { month: 'short', ...(ser.length > 40 ? { year: '2-digit' } : { day: 'numeric' }) }));
    const vals = ser.map(([, v]) => v);
    h += `<div class="section-head"><h2>Net worth</h2><span class="rate-cap">${signed(vals[vals.length - 1] - vals[0])} since ${esc(labels[0])}</span></div>
      <div class="card">${lineChart(labels, [{ name: 'Net worth', color: '--s-invest', values: vals }], (i) => `<b>${esc(prettyDate(ser[i][0]))}</b>${tipRow('--s-invest', 'Net worth', money0(vals[i]))}`)}
      ${tableToggle('nw', ['Date', 'Net worth'], ser.slice(-12).map(([d, v]) => [d, money0(v)]))}</div>`;
  }

  // Allocation
  const byKind = {};
  for (const a of pf.accounts) byKind[a.kind] = (byKind[a.kind] || 0) + Math.max(0, a.value);
  const kinds = Object.entries(byKind).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (kinds.length) {
    const items = kinds.slice(0, 7).map(([k, v], i) => ({ label: `${ACCOUNT_KINDS[k][1]} ${ACCOUNT_KINDS[k][0]}`, value: v, color: `--c${i + 1}` }));
    const tot = sum(items, (i) => i.value);
    h += `<div class="section-head"><h2>Allocation</h2></div><div class="card"><div class="donut-wrap">${donut(items, moneyC(tot), 'invested')}
      <div class="cat-list">${items.map((i) => `<div class="cat-item"><i class="dot" style="background:var(${i.color})"></i><span class="name">${esc(i.label)}</span><span class="val">${pct(i.value / tot)}</span></div>`).join('')}</div></div></div>`;
  }

  // Monthly contributions (12 months)
  const groups = [];
  for (let i = 11; i >= 0; i--) {
    const key = addMonths(thisMonth(), -i);
    groups.push({ key, label: monthName(key, 'short').slice(0, 1), title: monthName(key), values: [monthTotals(key).invest] });
  }
  if (groups.some((g) => g.values[0] > 0)) {
    h += `<div class="section-head"><h2>Contributions</h2><span class="rate-cap">Last 12 months</span></div>
      <div class="card">${barChart(groups, [{ name: 'Invested', color: '--s-invest' }], 150)}
      ${tableToggle('contrib', ['Month', 'Invested'], groups.map((g) => [g.title, money0(g.values[0])]))}</div>`;
  }

  // Accounts
  const order = Object.keys(ACCOUNT_KINDS);
  const accts = [...state.accounts].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.value - a.value);
  h += `<div class="section-head"><h2>Accounts</h2><button class="link" data-action="new-account">Add</button></div>`;
  h += `<div class="list">${accts.map((a) => {
    const g = a.value - (a.basis || 0);
    const showGain = isInvestKind(a.kind) && a.basis > 0;
    return `<button class="row" data-action="edit-account" data-id="${a.id}">
      <div class="row-icon">${ACCOUNT_KINDS[a.kind][1]}</div>
      <div class="row-main"><div class="row-title">${esc(a.name)}</div><div class="row-sub">${esc(ACCOUNT_KINDS[a.kind][0])}${a.updated ? ` · updated ${esc(prettyDate(a.updated).toLowerCase())}` : ''}</div></div>
      <div class="row-end"><div class="row-amt amt">${a.kind === 'debt' ? '−' : ''}${esc(money0(Math.abs(a.value)))}</div>
      ${showGain ? `<div class="row-meta amt status ${g >= 0 ? 'good' : 'bad'}">${g >= 0 ? '▲' : '▼'} ${pct(Math.abs(g / a.basis), 1)}</div>` : '<div class="row-meta">&nbsp;</div>'}</div>
    </button>`;
  }).join('')}</div>
  <p class="form-hint" style="margin:10px 4px">Tip: tap an account to update its value. Logging an <b>Invest</b> transaction adds to that account automatically.</p>`;
  return h;
}

function renderPlan() {
  const k = ui.month;
  let h = `<h1 class="page-title">Plan</h1><p class="page-sub">Budgets, goals and your future.</p>`;

  // Budgets
  const budgets = Object.entries(state.budgets).filter(([, v]) => v > 0);
  h += `<div class="section-head"><h2>Budgets</h2><button class="link" data-action="edit-budgets">${budgets.length ? 'Edit' : 'Set up'}</button></div>`;
  if (!budgets.length) {
    h += emptyState('🧮', 'Set monthly limits per category and see how you\'re tracking.');
  } else {
    const spentBy = {};
    for (const t of txInMonth(k)) if (t.type === 'expense') spentBy[t.category] = (spentBy[t.category] || 0) + t.amount;
    const isCurrent = k === thisMonth();
    const dayFrac = isCurrent ? new Date().getDate() / daysInMonth(k) : 1;
    const totalB = sum(budgets, (b) => b[1]);
    const totalS = sum(budgets, (b) => spentBy[b[0]] || 0);
    h += `<div class="card"><div class="budget-row" style="padding-top:0">
      <div class="budget-top"><span class="left">Total</span><span class="right amt">${esc(money0(totalS))} of ${esc(money0(totalB))}</span></div>
      <div class="bar"><i style="width:${clamp(totalS / totalB, 0, 1) * 100}%;background:var(--accent)"></i></div>
      <div class="budget-note">${totalB - totalS >= 0 ? `<span class="amt">${esc(money0(totalB - totalS))}</span> left${isCurrent ? ` · ${daysInMonth(k) - new Date().getDate()} days to go` : ''}` : `<span class="status bad">Over by <span class="amt">${esc(money0(totalS - totalB))}</span></span>`}</div>
    </div>`;
    for (const [c, b] of budgets.sort((a, b2) => (spentBy[b2[0]] || 0) / b2[1] - (spentBy[a[0]] || 0) / a[1])) {
      const s = spentBy[c] || 0;
      const f = s / b;
      const status = f > 1 ? ['bad', '⛔ Over'] : f > dayFrac + 0.1 && f > 0.75 ? ['warn', '⚠️ Running hot'] : ['good', '✓ On track'];
      const color = f > 1 ? '--bad' : f > dayFrac + 0.1 && f > 0.75 ? '--warn' : '--good';
      h += `<div class="budget-row">
        <div class="budget-top"><span class="left">${catEmoji('expense', c)} ${esc(c)}</span><span class="right amt">${esc(money0(s))} / ${esc(money0(b))}</span></div>
        <div class="bar"><i style="width:${clamp(f, 0, 1) * 100}%;background:var(${color})"></i></div>
        <div class="budget-note"><span class="status ${status[0]}">${status[1]}</span> · ${f <= 1 ? `<span class="amt">${esc(money0(b - s))}</span> left` : `<span class="amt">${esc(money0(s - b))}</span> over`}</div>
      </div>`;
    }
    h += '</div>';
  }

  // Goals
  h += `<div class="section-head"><h2>Goals</h2><button class="link" data-action="new-goal">Add</button></div>`;
  if (!state.goals.length) {
    h += emptyState('🎯', 'Saving for a trip, a house or an emergency fund? Add a goal and track it.');
  } else {
    h += `<div class="card" style="padding-top:4px;padding-bottom:4px">${state.goals.map((g) => {
      const f = g.target > 0 ? g.saved / g.target : 0;
      let sub = `<span class="amt">${esc(money0(g.saved))}</span> of <span class="amt">${esc(money0(g.target))}</span>`;
      if (f >= 1) sub += ' · 🎉 Reached!';
      else if (g.deadline) {
        const [dy, dm] = g.deadline.split('-').map(Number);
        const now = new Date();
        const monthsLeft = Math.max(1, (dy - now.getFullYear()) * 12 + (dm - 1 - now.getMonth()));
        sub += ` · <span class="amt">${esc(money0((g.target - g.saved) / monthsLeft))}</span>/mo for ${monthsLeft} mo`;
      }
      return `<button class="goal" data-action="edit-goal" data-id="${g.id}">${ring(f, f >= 1 ? '--good' : '--accent', 52, 6, pct(Math.min(f, 1)))}
        <div class="row-main"><div class="row-title">${esc(g.emoji || '🎯')} ${esc(g.name)}</div><div class="row-sub">${sub}</div></div></button>`;
    }).join('')}</div>`;
  }

  // Projection
  h += `<div class="section-head"><h2>Future you</h2></div>`;
  h += `<div class="card" id="projection">${projectionHTML()}</div>`;

  // Recurring
  h += `<div class="section-head"><h2>Recurring</h2><span class="rate-cap">Add from the + sheet</span></div>`;
  if (!state.recurring.length) {
    h += emptyState('🔁', 'Salary, rent, subscriptions… set them once with <b>Repeat</b> when adding a transaction.');
  } else {
    const monthlyIn = sum(state.recurring.filter((r) => r.type === 'income'), monthlyEquivalent);
    const monthlyOut = sum(state.recurring.filter((r) => r.type !== 'income'), monthlyEquivalent);
    h += `<div class="list">${[...state.recurring].sort((a, b) => (a.next < b.next ? -1 : 1)).map((r) => `<button class="row" data-action="edit-recurring" data-id="${r.id}">
      <div class="row-icon" style="box-shadow:inset 0 0 0 1.5px var(${TYPE_META[r.type].color})">${catEmoji(r.type, r.category)}</div>
      <div class="row-main"><div class="row-title">${esc(r.note || txLabel(r))}</div><div class="row-sub">${esc(FREQS[r.freq])} · next ${esc(prettyDate(r.next).toLowerCase())}</div></div>
      <div class="row-end"><div class="row-amt amt ${r.type === 'income' ? 'pos' : ''}">${r.type === 'income' ? '' : '−'}${esc(money(r.amount))}</div><div class="row-meta">${TYPE_META[r.type].label}</div></div>
    </button>`).join('')}</div>
    <p class="form-hint" style="margin:10px 4px">Fixed monthly: <b class="amt">${esc(money0(monthlyIn))}</b> in, <b class="amt">${esc(money0(monthlyOut))}</b> out.</p>`;
  }
  return h;
}

function projectionInputs() {
  const c = state.settings.calc;
  const pf = portfolio();
  const monthly = c.monthly != null ? c.monthly : Math.round(avgMonthly('invest', 3) || monthTotals(thisMonth()).invest);
  return { start: pf.value, monthly, rate: c.rate, years: c.years };
}
function projectionHTML() {
  const { start, monthly, rate, years } = projectionInputs();
  const r = rate / 100 / 12;
  const labels = [], grow = [], contrib = [];
  let v = start, paid = start;
  const nowY = new Date().getFullYear();
  for (let y = 0; y <= years; y++) {
    labels.push(String(nowY + y));
    grow.push(Math.round(v));
    contrib.push(Math.round(paid));
    for (let mo = 0; mo < 12; mo++) { v = v * (1 + r) + monthly; paid += monthly; }
  }
  const final = grow[grow.length - 1];
  const annualExp = (avgMonthly('expense', 3) || monthTotals(thisMonth()).expense) * 12;
  const fiNumber = annualExp * 25;
  let fiYears = null;
  if (fiNumber > 0) {
    let x = start;
    for (let mo = 0; mo <= 12 * 70; mo++) { if (x >= fiNumber) { fiYears = mo / 12; break; } x = x * (1 + r) + monthly; }
  }
  const series = [
    { name: 'With growth', color: '--s-invest', values: grow },
    { name: 'Just contributions', color: '--c2', values: contrib, dashed: true },
  ];
  return `<div class="card-title">In ${years} years you could have</div>
    <div class="big-number amt">${esc(money0(final))}</div>
    <div class="rate-cap" style="margin-bottom:12px">Of which <b class="amt">${esc(money0(final - contrib[contrib.length - 1]))}</b> is growth: money your money made.</div>
    ${legend(series)}
    ${lineChart(labels, series, (i) => `<b>${labels[i]}</b>${tipRow('--s-invest', 'With growth', money0(grow[i]))}${tipRow('--c2', 'Contributions', money0(contrib[i]))}`, { area: true })}
    <div class="form-group" style="margin-bottom:0">
      <div class="form-row"><label>Starting with</label><input class="amt" value="${esc(money0(start))}" disabled></div>
      <div class="form-row"><label for="calc-monthly">Monthly</label><input id="calc-monthly" inputmode="decimal" value="${monthly}" data-calc="monthly"></div>
      <div class="form-row"><label for="calc-rate">Return / yr</label><input id="calc-rate" inputmode="decimal" value="${rate}" data-calc="rate"><span class="rate-cap">%</span></div>
      <div class="form-row"><label for="calc-years">Years</label><input id="calc-years" inputmode="numeric" value="${years}" data-calc="years"></div>
    </div>
    ${fiNumber > 0 ? `<div class="insight" style="border-top:0.5px solid var(--line);margin-top:14px">
      <div class="insight-ico">🏝️</div><div><p>Financial independence number: <b class="amt">${esc(money0(fiNumber))}</b></p>
      <small>25× your yearly spending (the 4% rule). ${fiYears != null ? `At this pace you'd get there in <b>${fiYears < 1 ? 'under a year' : `${fiYears.toFixed(1)} years`}</b>, around ${nowY + Math.ceil(fiYears)}.` : 'Increase contributions to reach it within 70 years.'}</small></div></div>` : ''}
    <p class="form-hint" style="margin:10px 0 0">Projections assume a steady return and aren't guarantees. Starting value = current portfolio.</p>`;
}

/* ---------- Sheets ---------- */
const sheet = $('#sheet'), backdrop = $('#sheet-backdrop'), sheetBody = $('#sheet-body');
function openSheet(html, mount) {
  hideTip();
  sheetBody.innerHTML = html;
  sheet.hidden = false; backdrop.hidden = false;
  sheetBody.scrollTop = 0;
  requestAnimationFrame(() => { sheet.classList.add('open'); backdrop.classList.add('open'); });
  if (mount) mount(sheetBody);
  $$('.amount-input input', sheetBody).forEach(sizeAmountInput);
}
function closeSheet() {
  sheet.classList.remove('open'); backdrop.classList.remove('open');
  setTimeout(() => { if (!sheet.classList.contains('open')) { sheet.hidden = true; backdrop.hidden = true; sheetBody.innerHTML = ''; } }, 320);
}
backdrop.addEventListener('click', closeSheet);
// swipe-down to dismiss
(() => {
  let y0 = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    if (sheetBody.scrollTop > 0 && !e.target.closest('.sheet-grabber, .sheet-head')) return;
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  sheet.addEventListener('touchend', () => {
    if (y0 == null) return;
    sheet.style.transition = ''; sheet.style.transform = '';
    if (dy > 110) closeSheet();
    y0 = null;
  });
})();

function sheetHead(title, rightLabel = 'Save') {
  return `<div class="sheet-head"><button class="btn-text" data-sheet="cancel">Cancel</button><h3>${esc(title)}</h3><button class="btn-text" data-sheet="save">${esc(rightLabel)}</button></div>`;
}

function txSheet(existing, preset = {}) {
  const t = existing ? { ...existing } : { type: preset.type || 'expense', amount: '', category: null, accountId: preset.accountId || null, date: preset.date || defaultDateForMonth(), note: '', freq: 'none' };
  const draw = () => {
    const cats = t.type === 'invest' ? null : CATS[t.type];
    if (cats && !cats.some((c) => c[0] === t.category)) t.category = cats[0][0];
    const invAccts = state.accounts.filter((a) => isInvestKind(a.kind) || a.kind === 'cash');
    if (t.type === 'invest' && !t.accountId && invAccts.length) t.accountId = (invAccts.find((a) => isInvestKind(a.kind)) || invAccts[0]).id;
    let h = sheetHead(existing ? 'Edit transaction' : 'New transaction');
    h += `<div class="segmented" style="margin-top:4px">${['expense', 'income', 'invest'].map((ty) => `<button data-type="${ty}" class="${t.type === ty ? 'active' : ''}">${TYPE_META[ty].label}</button>`).join('')}</div>`;
    h += `<div class="amount-input"><span style="color:var(--text-3)">${esc(currencySymbol())}</span><input id="f-amount" inputmode="decimal" placeholder="0" value="${t.amount === '' ? '' : esc(t.amount)}" autocomplete="off"></div>`;
    if (cats) {
      h += `<div class="cat-grid">${cats.map(([c, e]) => `<button class="cat-btn ${t.category === c ? 'active' : ''}" data-cat="${esc(c)}"><span class="e">${e}</span><span>${esc(c)}</span></button>`).join('')}</div>`;
    } else {
      h += `<div class="cat-grid">${invAccts.map((a) => `<button class="cat-btn ${t.accountId === a.id ? 'active' : ''}" data-acct="${a.id}"><span class="e">${ACCOUNT_KINDS[a.kind][1]}</span><span>${esc(a.name)}</span></button>`).join('')}
        <button class="cat-btn" data-action-inner="new-account"><span class="e">➕</span><span>New account</span></button></div>`;
      h += `<p class="form-hint" style="margin:0 4px">The amount is added to the chosen account's value and cost basis.</p>`;
    }
    h += `<div class="form-group">
      <div class="form-row"><label for="f-date">Date</label><input id="f-date" type="date" value="${esc(t.date)}"></div>
      <div class="form-row"><label for="f-note">Note</label><input id="f-note" placeholder="Optional" value="${esc(t.note || '')}" autocomplete="off"></div>
      ${existing ? '' : `<div class="form-row"><label for="f-freq">Repeat</label><select id="f-freq">${Object.entries(FREQS).map(([k, l]) => `<option value="${k}" ${t.freq === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
    </div>`;
    if (existing) {
      h += `<button class="btn secondary" data-sheet="duplicate">Duplicate for today</button>`;
      h += `<button class="btn danger" data-sheet="delete">Delete transaction</button>`;
    }
    return h;
  };
  const capture = (root) => {
    t.amount = $('#f-amount', root).value;
    t.date = $('#f-date', root).value || today();
    t.note = $('#f-note', root).value.trim();
    const fq = $('#f-freq', root); if (fq) t.freq = fq.value;
  };
  const mount = (root) => {
    root.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.type) { capture(root); t.type = b.dataset.type; root.innerHTML = draw(); $$('.amount-input input', root).forEach(sizeAmountInput); focusAmount(root); return; }
      if (b.dataset.cat) { t.category = b.dataset.cat; $$('.cat-btn', root).forEach((x) => x.classList.toggle('active', x === b)); return; }
      if (b.dataset.acct) { t.accountId = b.dataset.acct; $$('.cat-btn', root).forEach((x) => x.classList.toggle('active', x === b)); return; }
      if (b.dataset.actionInner === 'new-account') { capture(root); accountSheet(null, (acc) => { t.accountId = acc.id; openSheet(draw(), mount); }, 'etf'); return; }
      const act = b.dataset.sheet;
      if (act === 'cancel') return closeSheet();
      if (act === 'delete') {
        if (!confirm('Delete this transaction?')) return;
        removeTxn(existing.id); snapshot(); save(); closeSheet(); render(); toast('Deleted'); return;
      }
      if (act === 'duplicate') {
        addTxn({ ...existing, id: uid(), date: today(), recurringId: undefined, created: Date.now() });
        snapshot(); save(); closeSheet(); render(); toast('Duplicated'); return;
      }
      if (act === 'save') {
        capture(root);
        const amt = parseAmount(t.amount);
        if (!(amt > 0)) { toast('Enter an amount'); focusAmount(root); return; }
        if (t.type === 'invest' && !t.accountId) { toast('Pick or create an account'); return; }
        const rec = {
          id: existing ? existing.id : uid(), type: t.type, amount: round2(amt),
          category: t.type === 'invest' ? 'Investment' : t.category, accountId: t.type === 'invest' ? t.accountId : undefined,
          date: t.date, note: t.note, recurringId: existing ? existing.recurringId : undefined, created: existing ? existing.created : Date.now(),
        };
        if (existing) removeTxn(existing.id);
        if (!existing && t.freq !== 'none') {
          const r = { id: uid(), type: rec.type, amount: rec.amount, category: rec.category, accountId: rec.accountId, note: rec.note, freq: t.freq, anchor: parseISO(rec.date).getDate() };
          rec.recurringId = r.id;
          r.next = advanceDate(rec.date, r.freq, r.anchor);
          state.recurring.push(r);
        }
        addTxn(rec);
        processRecurring();
        snapshot(); save(); closeSheet();
        ui.month = monthKey(rec.date);
        render();
        toast(existing ? 'Saved' : `${TYPE_META[rec.type].label} added${t.freq !== 'none' && !existing ? ' · repeats' : ''}`);
        if (navigator.vibrate) navigator.vibrate(10);
      }
    };
    if (!existing) focusAmount(root);
  };
  openSheet(draw(), mount);
}
function focusAmount(root) { const i = $('#f-amount', root); if (i) setTimeout(() => i.focus(), 350); }
function defaultDateForMonth() { return ui.month === thisMonth() ? today() : `${ui.month}-${pad(Math.min(15, daysInMonth(ui.month)))}`; }

function accountSheet(existing, after, presetKind) {
  const a = existing ? { ...existing } : { name: '', kind: presetKind || 'etf', value: '', basis: '' };
  let h = sheetHead(existing ? a.name : 'New account');
  h += `<div class="card-title" style="text-align:center;margin-top:8px">${existing ? 'Current value' : 'Current value / balance'}</div>`;
  h += `<div class="amount-input" style="padding-top:0"><span style="color:var(--text-3)">${esc(currencySymbol())}</span><input id="a-value" inputmode="decimal" placeholder="0" value="${a.value === '' ? '' : Math.abs(a.value)}"></div>`;
  if (existing && isInvestKind(a.kind) && a.basis > 0) {
    const g = a.value - a.basis;
    h += `<p class="form-hint" style="text-align:center;margin:0 0 6px">Gain: <b class="amt status ${g >= 0 ? 'good' : 'bad'}">${signed(g)} (${pct(Math.abs(g / a.basis), 1)})</b></p>`;
  }
  h += `<div class="form-group">
    <div class="form-row"><label for="a-name">Name</label><input id="a-name" placeholder="e.g. Brokerage, 401(k)" value="${esc(a.name)}"></div>
    <div class="form-row"><label for="a-kind">Type</label><select id="a-kind">${Object.entries(ACCOUNT_KINDS).map(([k, [l, e]]) => `<option value="${k}" ${a.kind === k ? 'selected' : ''}>${e} ${l}</option>`).join('')}</select></div>
    <div class="form-row" id="basis-row"><label for="a-basis">Total put in</label><input id="a-basis" inputmode="decimal" placeholder="Same as value" value="${a.basis === '' || a.basis == null ? '' : a.basis}"></div>
  </div>
  <p class="form-hint">“Total put in” is your cost basis: how much of your own money went in. It's used to calculate gains.</p>`;
  if (existing) h += `<button class="btn danger" data-sheet="delete">Delete account</button>`;
  openSheet(h, (root) => {
    const syncBasis = () => { $('#basis-row', root).style.display = isInvestKind($('#a-kind', root).value) ? '' : 'none'; };
    $('#a-kind', root).onchange = syncBasis; syncBasis();
    if (!existing) setTimeout(() => $('#a-value', root).focus(), 350);
    root.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.sheet;
      if (act === 'cancel') { if (after && !existing) { closeSheet(); render(); } else closeSheet(); return; }
      if (act === 'delete') {
        const linked = state.transactions.filter((t) => t.accountId === existing.id).length;
        if (!confirm(`Delete “${existing.name}”?${linked ? ` ${linked} linked transaction(s) will be kept but unlinked.` : ''}`)) return;
        state.accounts = state.accounts.filter((x) => x.id !== existing.id);
        state.transactions.forEach((t) => { if (t.accountId === existing.id) t.accountId = undefined; });
        state.recurring = state.recurring.filter((r) => r.accountId !== existing.id);
        snapshot(); save(); closeSheet(); render(); return;
      }
      if (act === 'save') {
        const name = $('#a-name', root).value.trim();
        const kind = $('#a-kind', root).value;
        const value = parseAmount($('#a-value', root).value || '0');
        const basisRaw = $('#a-basis', root).value;
        if (!name) { toast('Give it a name'); return; }
        if (!Number.isFinite(value)) { toast('Enter a value'); return; }
        const basis = basisRaw === '' ? (existing ? existing.basis ?? value : value) : parseAmount(basisRaw);
        const rec = { id: existing ? existing.id : uid(), name, kind, value: round2(kind === 'debt' ? Math.abs(value) : value), basis: isInvestKind(kind) ? round2(basis || 0) : 0, updated: today() };
        if (existing) Object.assign(state.accounts.find((x) => x.id === existing.id), rec);
        else state.accounts.push(rec);
        snapshot(); save();
        toast(existing ? 'Account updated' : 'Account added');
        if (after) after(rec); else { closeSheet(); render(); }
      }
    };
  });
}

function goalSheet(existing) {
  const g = existing ? { ...existing } : { name: '', emoji: '🎯', target: '', saved: '', deadline: '' };
  const emojis = ['🎯', '🛟', '✈️', '🏠', '🚗', '💍', '🎓', '👶', '💻', '🏝️', '🎸', '📦'];
  let h = sheetHead(existing ? 'Edit goal' : 'New goal');
  h += `<div class="cat-grid" style="grid-template-columns:repeat(6,1fr)">${emojis.map((e) => `<button class="cat-btn ${g.emoji === e ? 'active' : ''}" data-emoji="${e}"><span class="e">${e}</span></button>`).join('')}</div>`;
  h += `<div class="form-group">
    <div class="form-row"><label for="g-name">Name</label><input id="g-name" placeholder="e.g. Emergency fund" value="${esc(g.name)}"></div>
    <div class="form-row"><label for="g-target">Target</label><input id="g-target" inputmode="decimal" placeholder="0" value="${esc(g.target)}"></div>
    <div class="form-row"><label for="g-saved">Saved so far</label><input id="g-saved" inputmode="decimal" placeholder="0" value="${esc(g.saved)}"></div>
    <div class="form-row"><label for="g-deadline">Target date</label><input id="g-deadline" type="month" value="${esc(g.deadline || '')}"></div>
  </div>`;
  if (existing) {
    h += `<div class="form-group"><div class="form-row"><label for="g-add">Add money</label><input id="g-add" inputmode="decimal" placeholder="+0"></div></div>`;
    h += `<button class="btn danger" data-sheet="delete">Delete goal</button>`;
  }
  openSheet(h, (root) => {
    root.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.emoji) { g.emoji = b.dataset.emoji; $$('[data-emoji]', root).forEach((x) => x.classList.toggle('active', x === b)); return; }
      const act = b.dataset.sheet;
      if (act === 'cancel') return closeSheet();
      if (act === 'delete') { if (!confirm('Delete this goal?')) return; state.goals = state.goals.filter((x) => x.id !== existing.id); save(); closeSheet(); render(); return; }
      if (act === 'save') {
        const name = $('#g-name', root).value.trim();
        const target = parseAmount($('#g-target', root).value);
        let saved = parseAmount($('#g-saved', root).value || '0');
        const add = existing ? parseAmount($('#g-add', root).value || '0') : 0;
        if (!name || !(target > 0)) { toast('Name and target required'); return; }
        saved = round2((saved || 0) + (add || 0));
        const rec = { id: existing ? existing.id : uid(), name, emoji: g.emoji, target: round2(target), saved, deadline: $('#g-deadline', root).value };
        if (existing) Object.assign(state.goals.find((x) => x.id === existing.id), rec); else state.goals.push(rec);
        save(); closeSheet(); render();
        if (saved >= target && (!existing || existing.saved < existing.target)) toast('🎉 Goal reached!'); else toast('Goal saved');
      }
    };
  });
}

function budgetsSheet() {
  const avg = {};
  for (let i = 1; i <= 3; i++) for (const t of txInMonth(addMonths(thisMonth(), -i))) if (t.type === 'expense') avg[t.category] = (avg[t.category] || 0) + t.amount / 3;
  let h = sheetHead('Monthly budgets');
  h += `<p class="form-hint" style="margin:6px 4px 0">Leave blank for no limit. Grey numbers show your 3-month average.</p>`;
  h += `<div class="form-group">${CATS.expense.map(([c, e]) => `<div class="form-row"><label>${e} ${esc(c)}</label>
    <input data-budget="${esc(c)}" inputmode="decimal" placeholder="${avg[c] ? esc(money0(avg[c])) : '—'}" value="${state.budgets[c] || ''}"></div>`).join('')}</div>`;
  h += `<button class="btn secondary" data-sheet="suggest">Suggest from my spending</button>`;
  openSheet(h, (root) => {
    root.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.sheet;
      if (act === 'cancel') return closeSheet();
      if (act === 'suggest') {
        $$('[data-budget]', root).forEach((inp) => { const v = avg[inp.dataset.budget]; if (v) inp.value = Math.ceil(v / 10) * 10; });
        toast('Filled with your averages (rounded up)'); return;
      }
      if (act === 'save') {
        const nb = {};
        $$('[data-budget]', root).forEach((inp) => { const v = parseAmount(inp.value); if (v > 0) nb[inp.dataset.budget] = round2(v); });
        state.budgets = nb; save(); closeSheet(); render(); toast('Budgets saved');
      }
    };
  });
}

function recurringSheet(r) {
  let h = sheetHead('Recurring');
  h += `<div class="amount-input"><span style="color:var(--text-3)">${esc(currencySymbol())}</span><input id="r-amount" inputmode="decimal" value="${r.amount}"></div>`;
  h += `<div class="form-group">
    <div class="form-row"><label>Category</label><input value="${esc(txLabel(r))}" disabled></div>
    <div class="form-row"><label for="r-note">Note</label><input id="r-note" value="${esc(r.note || '')}"></div>
    <div class="form-row"><label for="r-freq">Repeat</label><select id="r-freq">${Object.entries(FREQS).filter(([k]) => k !== 'none').map(([k, l]) => `<option value="${k}" ${r.freq === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="form-row"><label for="r-next">Next on</label><input id="r-next" type="date" value="${r.next}"></div>
  </div>
  <p class="form-hint">Changes apply to future entries. Past transactions stay as they are.</p>
  <button class="btn danger" data-sheet="delete">Stop repeating</button>`;
  openSheet(h, (root) => {
    root.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.sheet;
      if (act === 'cancel') return closeSheet();
      if (act === 'delete') { state.recurring = state.recurring.filter((x) => x.id !== r.id); save(); closeSheet(); render(); toast('Stopped'); return; }
      if (act === 'save') {
        const amt = parseAmount($('#r-amount', root).value);
        if (!(amt > 0)) { toast('Enter an amount'); return; }
        const rec = state.recurring.find((x) => x.id === r.id);
        rec.amount = round2(amt);
        rec.note = $('#r-note', root).value.trim();
        rec.freq = $('#r-freq', root).value;
        rec.next = $('#r-next', root).value || rec.next;
        rec.anchor = parseISO(rec.next).getDate();
        processRecurring(); save(); closeSheet(); render(); toast('Saved');
      }
    };
  });
}

function settingsSheet() {
  const s = state.settings;
  let h = `<div class="sheet-head"><span style="min-width:64px"></span><h3>Settings</h3><button class="btn-text" data-sheet="cancel" style="font-weight:600;text-align:right">Done</button></div>`;
  h += `<div class="form-group">
    <div class="form-row"><label for="s-name">Your name</label><input id="s-name" placeholder="Optional" value="${esc(s.name)}"></div>
    <div class="form-row"><label for="s-cur">Currency</label><select id="s-cur">${CURRENCIES.map((c) => `<option ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="form-row"><label for="s-theme">Appearance</label><select id="s-theme">${[['auto', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<option value="${k}" ${s.theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="form-row"><label for="s-priv">Hide amounts</label><span style="flex:1"></span><input id="s-priv" type="checkbox" ${s.privacy ? 'checked' : ''}></div>
  </div>
  <div class="card-title" style="margin:20px 4px 6px">Your data</div>
  <p class="form-hint" style="margin:0 4px 8px">Everything is stored only on this device. Export a backup regularly (e.g. to Files or iCloud Drive).</p>
  <button class="btn secondary" data-sheet="export">⬇️ Export backup (JSON)</button>
  <button class="btn secondary" data-sheet="import">⬆️ Restore from backup</button>
  <button class="btn secondary" data-sheet="csv">📄 Export transactions (CSV)</button>
  <input type="file" id="s-file" accept="application/json,.json" hidden>
  <div class="card-title" style="margin:20px 4px 6px">More</div>
  <button class="btn secondary" data-sheet="demo">✨ Load sample data</button>
  <button class="btn danger" data-sheet="erase">Erase all data</button>
  <div class="card" style="margin-top:20px">
    <div class="card-title">Install on iPhone</div>
    <p style="margin:0;font-size:14px;color:var(--text-2)">In Safari tap <b>Share</b> → <b>Add to Home Screen</b>. Ledger then opens full-screen like a native app and works offline.</p>
  </div>
  <p class="form-hint" style="text-align:center;margin-top:16px">Ledger · ${state.transactions.length} transactions · ${state.accounts.length} accounts</p>`;
  openSheet(h, (root) => {
    $('#s-name', root).onchange = (e) => { s.name = e.target.value.trim(); save(); render(); };
    $('#s-cur', root).onchange = (e) => { s.currency = e.target.value; save(); render(); toast(`Currency: ${s.currency}`); };
    $('#s-theme', root).onchange = (e) => { s.theme = e.target.value; save(); render(); };
    $('#s-priv', root).onchange = (e) => { s.privacy = e.target.checked; save(); render(); };
    $('#s-file', root).onchange = (e) => importFile(e.target.files[0]);
    root.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const act = b.dataset.sheet;
      if (act === 'cancel') return closeSheet();
      if (act === 'export') return exportJSON();
      if (act === 'import') return $('#s-file', root).click();
      if (act === 'csv') return exportCSV();
      if (act === 'demo') {
        if ((state.transactions.length || state.accounts.length) && !confirm('Replace your current data with sample data?')) return;
        loadDemo(); closeSheet(); return;
      }
      if (act === 'erase') {
        if (!confirm('Erase ALL data on this device? This cannot be undone. Export a backup first if unsure.')) return;
        state = defaultState(); state.settings.onboarded = true; save(); closeSheet(); ui.tab = 'home'; render(); toast('All data erased');
      }
    };
  });
}

/* ---------- Import / export ---------- */
async function shareOrDownload(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  try {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportJSON() { shareOrDownload(`ledger-backup-${today()}.json`, JSON.stringify(state, null, 2), 'application/json'); }
function exportCSV() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Date', 'Type', 'Category', 'Account', 'Amount', 'Note'].join(',')];
  for (const t of [...state.transactions].sort(byDateDesc)) {
    rows.push([t.date, t.type, t.type === 'invest' ? 'Investment' : t.category, t.type === 'invest' ? (accountById(t.accountId) || {}).name || '' : '', (t.type === 'income' ? '' : '-') + t.amount.toFixed(2), t.note].map(q).join(','));
  }
  shareOrDownload(`ledger-transactions-${today()}.csv`, rows.join('\n'), 'text/csv');
}
function importFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || !Array.isArray(data.transactions) || !Array.isArray(data.accounts)) throw new Error('Not a Ledger backup');
      if (!confirm(`Restore backup with ${data.transactions.length} transactions? This replaces current data.`)) return;
      const d = defaultState();
      state = { ...d, ...data, settings: { ...d.settings, ...(data.settings || {}) } };
      save(); closeSheet(); render(); toast('Backup restored');
    } catch (e) { alert(`Couldn't restore: ${e.message}`); }
  };
  reader.readAsText(file);
}

/* ---------- Sample data ---------- */
function loadDemo() {
  const s = defaultState();
  s.settings = { ...state.settings, onboarded: true };
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const between = (a, b) => round2(a + rnd() * (b - a));
  const now = new Date();
  const months = 8;
  const accts = {
    checking: { id: uid(), name: 'Checking', kind: 'cash', value: 0, basis: 0 },
    hysa: { id: uid(), name: 'High-yield savings', kind: 'cash', value: 0, basis: 0 },
    index: { id: uid(), name: 'Total market index', kind: 'etf', value: 0, basis: 0 },
    retire: { id: uid(), name: 'Retirement (401k)', kind: 'retirement', value: 0, basis: 0 },
    stocks: { id: uid(), name: 'Brokerage picks', kind: 'stocks', value: 0, basis: 0 },
    crypto: { id: uid(), name: 'Crypto', kind: 'crypto', value: 0, basis: 0 },
    car: { id: uid(), name: 'Car loan', kind: 'debt', value: 0, basis: 0 },
  };
  // starting balances
  accts.checking.value = 3200; accts.hysa.value = 9500;
  accts.index.value = accts.index.basis = 18000; accts.retire.value = accts.retire.basis = 24000;
  accts.stocks.value = accts.stocks.basis = 4200; accts.crypto.value = accts.crypto.basis = 1500;
  accts.car.value = 11800;
  const tx = [];
  const add = (type, amount, category, date, note, accountId) => tx.push({ id: uid(), type, amount: round2(amount), category, date, note, accountId, created: 0 });
  const monthlyGrowth = { index: 0.008, retire: 0.007, stocks: 0.011, crypto: 0.02 };
  const nw = {};
  for (let i = months - 1; i >= 0; i--) {
    const y = now.getFullYear(), m = now.getMonth() - i;
    const base = new Date(y, m, 1);
    const key = ymKey(base.getFullYear(), base.getMonth());
    const dim = daysInMonth(key);
    const lastDay = i === 0 ? now.getDate() : dim;
    const d = (day) => `${key}-${pad(Math.min(day, dim))}`;
    const inRange = (day) => day <= lastDay;
    if (inRange(1)) add('income', 5400, 'Salary', d(1), 'Paycheck');
    if (inRange(15)) add('income', 5400, 'Salary', d(15), 'Paycheck');
    if (rnd() > 0.5 && inRange(20)) add('income', between(400, 1400), 'Freelance', d(20), 'Side project');
    if (inRange(28)) add('income', between(18, 60), 'Dividends', d(28), 'Index fund dividend');
    if (inRange(30)) add('income', between(25, 38), 'Interest', d(30), 'Savings interest');
    if (inRange(1)) add('expense', 2150, 'Housing', d(1), 'Rent');
    if (inRange(5)) add('expense', 395, 'Transport', d(5), 'Car payment');
    if (inRange(8)) add('expense', between(110, 170), 'Utilities', d(8), 'Electric & water');
    if (inRange(10)) add('expense', 65, 'Utilities', d(10), 'Phone & internet');
    if (inRange(12)) add('expense', 15.99, 'Subscriptions', d(12), 'Streaming');
    if (inRange(12)) add('expense', 10.99, 'Subscriptions', d(12), 'Music');
    if (inRange(3)) add('expense', 45, 'Health', d(3), 'Gym');
    if (inRange(18)) add('expense', 140, 'Insurance', d(18), 'Car insurance');
    for (let day = 2; day <= lastDay; day += 7) add('expense', between(85, 150), 'Groceries', d(day), 'Supermarket');
    for (let day = 4; day <= lastDay; day += Math.round(between(3, 6))) add('expense', between(18, 75), 'Dining', d(day), ['Sushi', 'Pizza night', 'Brunch', 'Coffee & pastries', 'Tacos'][Math.floor(rnd() * 5)]);
    for (let day = 6; day <= lastDay; day += 9) add('expense', between(35, 60), 'Transport', d(day), 'Gas');
    if (rnd() > 0.3 && inRange(14)) add('expense', between(40, 260), 'Shopping', d(14), ['Clothes', 'Headphones', 'Home stuff', 'Shoes'][Math.floor(rnd() * 4)]);
    if (rnd() > 0.4 && inRange(22)) add('expense', between(30, 120), 'Fun', d(22), ['Concert', 'Movies', 'Bowling', 'Games'][Math.floor(rnd() * 4)]);
    if (i === 3 && inRange(9)) add('expense', 1240, 'Travel', d(9), 'Weekend in the mountains');
    if (rnd() > 0.6 && inRange(25)) add('expense', between(20, 90), 'Personal', d(25), 'Haircut');
    // investing
    if (inRange(2)) { add('invest', 1000, 'Investment', d(2), 'Auto-invest', accts.index.id); }
    if (inRange(15)) { add('invest', 750, 'Investment', d(15), 'Payroll contribution', accts.retire.id); }
    if (inRange(16) && rnd() > 0.4) add('invest', between(150, 400), 'Investment', d(16), 'Buy the dip', accts.stocks.id);
    if (inRange(20)) add('invest', 100, 'Investment', d(20), 'Weekly DCA', accts.crypto.id);
    // apply month: contributions + growth
    for (const t of tx.filter((x) => monthKey(x.date) === key)) {
      if (t.type === 'invest') {
        const a = Object.values(accts).find((x) => x.id === t.accountId);
        a.value += t.amount; a.basis += t.amount;
      }
    }
    for (const [k, g] of Object.entries(monthlyGrowth)) accts[k].value *= 1 + g + (rnd() - 0.45) * (k === 'crypto' ? 0.12 : 0.04);
    accts.hysa.value += 300 + 32; accts.checking.value += between(-200, 450);
    accts.car.value = Math.max(0, accts.car.value - 330);
    const snapDate = i === 0 ? today() : d(dim);
    nw[snapDate] = round2(sum(Object.values(accts), (a) => (a.kind === 'debt' ? -a.value : a.value)));
    // a mid-month point for a smoother line
    if (i !== 0) nw[d(15)] = round2(nw[snapDate] - between(400, 1800));
  }
  Object.values(accts).forEach((a) => { a.value = round2(a.value); a.basis = round2(a.basis); a.updated = today(); });
  s.accounts = Object.values(accts);
  s.transactions = tx;
  s.nwHistory = nw;
  s.budgets = { Groceries: 520, Dining: 300, Shopping: 200, Fun: 150, Transport: 600, Utilities: 260, Subscriptions: 40 };
  s.goals = [
    { id: uid(), name: 'Emergency fund', emoji: '🛟', target: 20000, saved: round2(accts.hysa.value), deadline: '' },
    { id: uid(), name: 'Japan trip', emoji: '✈️', target: 6000, saved: 2350, deadline: ymKey(now.getFullYear() + 1, 3) },
    { id: uid(), name: 'House down payment', emoji: '🏠', target: 60000, saved: 14800, deadline: ymKey(now.getFullYear() + 3, 5) },
  ];
  const nextOf = (day) => { const n = new Date(now.getFullYear(), now.getMonth(), day); if (iso(n) <= today()) n.setMonth(n.getMonth() + 1); return iso(n); };
  s.recurring = [
    { id: uid(), type: 'income', amount: 5400, category: 'Salary', note: 'Paycheck', freq: 'monthly', anchor: 1, next: nextOf(1) },
    { id: uid(), type: 'income', amount: 5400, category: 'Salary', note: 'Paycheck', freq: 'monthly', anchor: 15, next: nextOf(15) },
    { id: uid(), type: 'expense', amount: 2150, category: 'Housing', note: 'Rent', freq: 'monthly', anchor: 1, next: nextOf(1) },
    { id: uid(), type: 'expense', amount: 15.99, category: 'Subscriptions', note: 'Streaming', freq: 'monthly', anchor: 12, next: nextOf(12) },
    { id: uid(), type: 'expense', amount: 10.99, category: 'Subscriptions', note: 'Music', freq: 'monthly', anchor: 12, next: nextOf(12) },
    { id: uid(), type: 'invest', amount: 1000, category: 'Investment', accountId: accts.index.id, note: 'Auto-invest', freq: 'monthly', anchor: 2, next: nextOf(2) },
  ];
  state = s;
  save();
  ui.month = thisMonth(); ui.tab = 'home';
  render();
  toast('Sample data loaded. Erase it anytime in Settings.');
}

/* ---------- Misc UI ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}
function applyTheme() {
  const th = state.settings.theme;
  if (th === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', th);
}

/* ---------- Event wiring ---------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('#sheet')) return;
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'edit-tx') { const t = state.transactions.find((x) => x.id === el.dataset.id); if (t) txSheet(t); }
  else if (a === 'edit-account') accountSheet(accountById(el.dataset.id));
  else if (a === 'new-account') accountSheet(null);
  else if (a === 'new-goal') goalSheet(null);
  else if (a === 'edit-goal') goalSheet(state.goals.find((g) => g.id === el.dataset.id));
  else if (a === 'edit-budgets') budgetsSheet();
  else if (a === 'edit-recurring') recurringSheet(state.recurring.find((r) => r.id === el.dataset.id));
  else if (a === 'filter') { ui.filter = el.dataset.filter; render(); }
  else if (a === 'go') { ui.tab = el.dataset.tab; if (el.dataset.filter) ui.filter = el.dataset.filter; render(); window.scrollTo(0, 0); }
  else if (a === 'toggle-table') { ui.tables[el.dataset.key] = !ui.tables[el.dataset.key]; const y = window.scrollY; render(); window.scrollTo(0, y); }
  else if (a === 'start-fresh') { state.settings.onboarded = true; save(); render(); settingsSheet(); }
  else if (a === 'load-demo') loadDemo();
});
function sizeAmountInput(inp) { inp.style.width = `${Math.max(1, (inp.value || inp.placeholder).length) + 0.6}ch`; }
document.addEventListener('input', (e) => {
  if (e.target.matches('.amount-input input')) sizeAmountInput(e.target);
  if (e.target.id === 'search') {
    ui.query = e.target.value;
    $('#act-results').innerHTML = activityResults();
  }
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset && e.target.dataset.calc;
  if (!k) return;
  const v = parseAmount(e.target.value);
  if (!Number.isFinite(v)) return;
  state.settings.calc[k] = k === 'years' ? clamp(Math.round(v), 1, 60) : k === 'rate' ? clamp(v, -20, 30) : Math.max(0, v);
  save();
  const y = window.scrollY;
  $('#projection').innerHTML = projectionHTML();
  window.scrollTo(0, y);
});

$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('.tab'); if (!b) return;
  if (ui.tab === b.dataset.tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  ui.tab = b.dataset.tab; render(); window.scrollTo(0, 0);
});
$('#fab').addEventListener('click', () => txSheet(null, ui.tab === 'invest' ? { type: 'invest' } : {}));
$('#btn-prev').addEventListener('click', () => { ui.month = addMonths(ui.month, -1); render(); });
$('#btn-next').addEventListener('click', () => { if (ui.month < thisMonth()) { ui.month = addMonths(ui.month, 1); render(); } });
$('#month-label').addEventListener('click', () => { ui.month = thisMonth(); render(); });
$('#btn-settings').addEventListener('click', settingsSheet);
$('#btn-privacy').addEventListener('click', () => {
  state.settings.privacy = !state.settings.privacy; save(); render();
  toast(state.settings.privacy ? 'Amounts hidden' : 'Amounts visible');
});

// Swipe left/right on the main view to change month (Home / Activity / Plan)
(() => {
  let x0 = null, y0 = null;
  const v = $('#view');
  v.addEventListener('touchstart', (e) => {
    if (e.target.closest('svg, .chips, input, .sheet')) { x0 = null; return; }
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
  }, { passive: true });
  v.addEventListener('touchend', (e) => {
    if (x0 == null || ui.tab === 'invest') return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      if (dx > 0) ui.month = addMonths(ui.month, -1);
      else if (ui.month < thisMonth()) ui.month = addMonths(ui.month, 1);
      else return;
      render();
    }
    x0 = null;
  });
})();

// Re-render charts on rotation / resize
let rT;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(render, 150); });
// Catch up recurring items when the app comes back to the foreground on a new day
let lastDay = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && today() !== lastDay) {
    lastDay = today();
    if (ui.month < thisMonth() && ui.month === addMonths(thisMonth(), -1)) ui.month = thisMonth();
    processRecurring(); render();
  }
});

/* ---------- Boot ---------- */
processRecurring();
if (state.accounts.length && !state.nwHistory[today()]) { snapshot(); save(); }
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
