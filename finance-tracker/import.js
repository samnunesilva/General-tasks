'use strict';

/* =========================================================================
   CSV import — bank statements from Wise, Wealthsimple and most banks.
   Everything happens on the device: the file is read locally and never sent
   anywhere. Uses helpers and state from app.js.
   ========================================================================= */

/* ---------- Categorisation rules ---------- */
// [pattern, type, category] — first match wins, so more specific rules come first.
const KEYWORD_RULES = [
  [/payroll|salary|direct dep|\bpay\b|paie|salaire/, 'income', 'Salary'],
  [/dividend/, 'income', 'Dividends'],
  [/interest|int[ée]r[êe]t/, 'income', 'Interest'],
  [/refund|reversal|rembours|cashback|cash back/, 'income', 'Refund'],
  [/\brent\b|landlord|loyer|mortgage|hypoth|property mgmt|condo fee/, 'expense', 'Housing'],
  [/uber ?eats|doordash|skip ?the ?dishes|tim horton|starbucks|mcdonald|\bsubway\b|\ba&w\b|restaurant|\bcaf[eé]\b|coffee|pizza|sushi|burger|\bpub\b|bistro|chipotle|popeyes|\bkfc\b|wendy|harvey|second cup|pho\b|ramen|bakery|boulangerie/, 'expense', 'Dining'],
  [/loblaw|no ?frills|sobeys|\bmetro\b|safeway|walmart|costco|superstore|freshco|food basics|\biga\b|\bmaxi\b|provigo|save[- ]on|whole foods|t ?& ?t|farm boy|longo|grocer|[ée]picerie|instacart|voila/, 'expense', 'Groceries'],
  [/\buber\b|\blyft\b|presto|\bopus\b|\bttc\b|\bstm\b|translink|compass card|petro|\besso\b|\bshell\b|husky|chevron|ultramar|parking|impark|via rail|go transit|communauto|\bevo\b|bixi|\bgas\b/, 'expense', 'Transport'],
  [/netflix|spotify|disney|crave|apple\.com|icloud|google (storage|one)|youtube|prime video|amazon prime|patreon|openai|chatgpt|anthropic|claude\.ai|adobe|microsoft|dropbox|audible/, 'expense', 'Subscriptions'],
  [/hydro|enbridge|fortis|\bbell\b|rogers|telus|\bfido\b|koodo|virgin (plus|mobile)|freedom mobile|vid[ée]otron|\bshaw\b|internet|electric/, 'expense', 'Utilities'],
  [/pharma|shoppers drug|rexall|jean coutu|dental|dentist|clinic|physio|optom|goodlife|fitness|\bgym\b|massage/, 'expense', 'Health'],
  [/air canada|westjet|porter|flair|airbnb|hotel|expedia|booking\.com|marriott|hilton|airline|airport/, 'expense', 'Travel'],
  [/cineplex|steam|playstation|xbox|nintendo|ticketmaster|concert|theat(re|er)|museum/, 'expense', 'Fun'],
  [/insurance|assurance|intact|belair|sun life|manulife|square one/, 'expense', 'Insurance'],
  [/\bcra\b|revenue canada|receiver general|\btax(es)?\b|imp[ôo]t/, 'expense', 'Taxes'],
  [/tuition|udemy|coursera|university|universit[ée]|college|coll[èe]ge|bookstore/, 'expense', 'Education'],
  [/barber|salon|haircut|\bspa\b|nails/, 'expense', 'Personal'],
  [/amazon|\bamzn\b|best buy|ikea|canadian tire|winners|marshalls|\bh&m\b|zara|uniqlo|hudson'?s bay|sephora|dollarama|shein|aliexpress|apple store|staples|indigo|sport chek|lululemon|etsy|ebay/, 'expense', 'Shopping'],
];
// Moves between your own accounts: not income or spending.
const OWN_TRANSFER = /converted|conversion|exchange(d)? (from|to)|to your .* balance|between (your|own)|own account|to yourself|from yourself|internal transfer|transfer (to|from) (wise|wealthsimple)|wealthsimple cash|\bwise\b|credit card payment|payment - thank you|paiement.*merci/;
const TO_INVESTMENT = /\btfsa\b|\brrsp\b|\bfhsa\b|\bresp\b|\bcelia?\b|\breer\b|\bcelapp\b|brokerage|questrade|wealthsimple (trade|invest)|managed invest|contribution/;
const INVEST_INTERNAL = /\b(buy|bought|sell|sold|purchase of|sale of)\b.*\b(shares?|units?|etf|stock|crypto|btc|eth)\b|\bbuy\b|\bsell\b|stock split|reinvest/;

// Wise's own categories (transaction-history export) → ours
const WISE_CATEGORIES = {
  'eating out': 'Dining', restaurants: 'Dining', groceries: 'Groceries', transport: 'Transport', travel: 'Travel',
  shopping: 'Shopping', bills: 'Utilities', entertainment: 'Fun', health: 'Health', 'personal care': 'Personal',
  education: 'Education', subscriptions: 'Subscriptions', housing: 'Housing', rent: 'Housing', gifts: 'Gifts',
};

// Wealthsimple activity codes (best effort — unknown codes fall back to the amount's sign)
const WS_CODES = {
  income: ['DEP', 'AFT_IN', 'E_TRFIN', 'EFT_IN', 'EFTIN', 'P2P_RECEIVED', 'PAYROLL', 'REFUND', 'CASHBACK', 'REIMB'],
  interest: ['INT', 'FPLINT', 'INTEREST'],
  dividend: ['DIV', 'DIVIDEND'],
  spend: ['SPEND', 'WD', 'AFT_OUT', 'E_TRFOUT', 'EFT_OUT', 'EFTOUT', 'P2P_SENT', 'BILLPAY', 'BILL_PAY', 'PURCHASE', 'ATM'],
  contribution: ['CONT', 'CONTRIBUTION', 'TRFIN', 'TRF_IN', 'TRANSFER_IN'],
  internal: ['BUY', 'SELL', 'FEE', 'NRT', 'TRFOUT', 'TRF_OUT', 'TRFINTF', 'INT_TRF', 'LOAN', 'RECALL', 'STKDIV', 'STKREORG', 'SPLIT', 'WITHHOLDING'],
};

/* ---------- Parsing ---------- */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [',', ';', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

function parseMoney(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || /^[-−]|[-−]$/.test(s) || /\bDR\b/i.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}
const isMoney = (s) => /^[\s(+\-−$€£¥]*[\d.,\s]+\)?\s*([A-Z]{3}|CR|DR)?$/i.test(s || '') && /\d/.test(s);

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, janv: 1, févr: 2, fevr: 2, mars: 3, avr: 4, mai: 5, juin: 6, juil: 7, août: 8, aout: 8, sept: 9, déc: 12 };
function mkDate(y, m, d) {
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1990 && y < 2100)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
function detectDateOrder(values) {
  let sep = null;
  for (const v of values) {
    const m = String(v).match(/^(\d{1,2})([-/.])(\d{1,2})\2\d{2,4}/);
    if (!m) continue;
    sep = sep || m[2];
    if (+m[1] > 12) return 'dmy';
    if (+m[3] > 12) return 'mdy';
  }
  return sep === '/' ? 'mdy' : 'dmy';
}
function parseDateStr(s, order) {
  s = String(s || '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return mkDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) return order === 'dmy' ? mkDate(+m[3], +m[2], +m[1]) : mkDate(+m[3], +m[1], +m[2]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return mkDate(+m[1], +m[2], +m[3]);
  m = s.toLowerCase().match(/^(\d{1,2})[\s-]+([a-zéû]{3,5})\.?[\s-]+(\d{2,4})/); // 24 Oct 2026
  if (m && MONTHS[m[2]]) return mkDate(+m[3], MONTHS[m[2]], +m[1]);
  m = s.toLowerCase().match(/^([a-zéû]{3,5})\.?\s+(\d{1,2}),?\s+(\d{4})/); // Oct 24, 2026
  if (m && MONTHS[m[1]]) return mkDate(+m[3], MONTHS[m[1]], +m[2]);
  return null;
}

const MERCHANT_NOISE = /\b(pos|purchase|achat|visa|debit|d[ée]bit|credit|interac|e ?transfer|virement|payment|paiement|card|carte|transaction|of|issued|by|to|from|pre-?authori[sz]ed|pad|online|www|com|ca|inc|ltd|the)\b/g;
function merchantKey(desc) {
  return String(desc).toLowerCase()
    .replace(/[0-9#*:/\\_.,'"()\-]+/g, ' ')
    .replace(MERCHANT_NOISE, ' ')
    .replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 3).join(' ');
}
function cleanDesc(s) {
  return String(s || '').replace(/\s+/g, ' ')
    .replace(/^(card transaction of [\d.,]+ [A-Z]{3} issued by|purchase:?|pre-?authori[sz]ed debit to|interac purchase -?|point of sale -?)\s*/i, '')
    .trim();
}

/* ---------- Format detection ---------- */
const H = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
function findCol(headers, re, exclude = []) {
  return headers.findIndex((h, i) => re.test(H(h)) && !exclude.includes(i));
}

function analyse(text) {
  const all = parseCSV(text);
  if (!all.length) throw new Error('The file is empty.');
  // Skip any preamble (account info lines) before the header row
  const HEADER_WORD = /date|created on|description|amount|montant|direction|transaction|balance|solde|debit|credit|withdrawal|deposit|payee|merchant|currency/i;
  let hi = all.findIndex((r, i) => i < 15 && r.length >= 3 && r.filter((c) => HEADER_WORD.test(c) && !isMoney(c) && !parseDateStr(c, 'mdy')).length >= 2);
  let headers, rows;
  if (hi >= 0) { headers = all[hi]; rows = all.slice(hi + 1); }
  else { headers = all[0].map(() => ''); rows = all; } // headerless (e.g. TD, Scotiabank)
  const width = Math.max(...rows.map((r) => r.length), headers.length);
  rows = rows.map((r) => { const c = r.slice(); while (c.length < width) c.push(''); return c; });
  while (headers.length < width) headers.push('');
  const hs = headers.map(H);

  let format = 'generic';
  if (hs.includes('transferwise id') || (hs.includes('running balance') && hs.includes('exchange rate'))) format = 'wise-statement';
  else if (hs.includes('direction') && hs.some((h) => h.startsWith('source amount'))) format = 'wise-history';
  else {
    const tc = hs.indexOf('transaction');
    if (tc >= 0 && hs.includes('amount')) {
      const codes = rows.map((r) => r[tc]).filter(Boolean);
      if (codes.length && codes.filter((c) => /^[A-Z][A-Z_]{1,15}$/.test(c)).length / codes.length > 0.8) format = 'wealthsimple';
    }
  }
  return { headers, rows, format, mapping: guessMapping(headers, rows, format) };
}

function guessMapping(headers, rows, format) {
  const m = { date: -1, desc: [], amount: -1, debit: -1, credit: -1, balance: -1, currency: -1, code: -1, negIsOut: true };
  if (format === 'wise-statement' || format === 'wise-history') return m; // handled by dedicated parsers
  if (headers.some((h) => h)) {
    m.date = findCol(headers, /^(date|transaction date|trans\.? date|posted date|posting date|date posted|date of transaction|date de (la )?transaction|created on)/);
    if (m.date < 0) m.date = findCol(headers, /date/);
    m.debit = findCol(headers, /debit|withdrawal|money out|paid out|retrait|d[ée]bit/);
    m.credit = findCol(headers, /credit|deposit|money in|paid in|d[ée]p[ôo]t|cr[ée]dit/, [m.debit]);
    m.amount = findCol(headers, /^(amount|amount \(cad\)|cad\$?|cad amount|montant|value|transaction amount|net amount)/);
    if (m.amount >= 0) { m.debit = -1; m.credit = -1; }
    m.balance = findCol(headers, /balance|solde/);
    m.currency = findCol(headers, /^(currency|devise|ccy)$/);
    m.code = format === 'wealthsimple' ? headers.map(H).indexOf('transaction') : -1;
    const descRe = /description|details|merchant|payee|memo|narrative|libell[ée]|transaction details|^name$|^transaction$/;
    m.desc = headers.map((h, i) => (descRe.test(H(h)) && i !== m.code ? i : -1)).filter((i) => i >= 0);
  } else {
    // Headerless: infer columns from the values
    const sample = rows.slice(0, 40);
    const order = detectDateOrder(sample.map((r) => r[0]));
    const width = headers.length;
    const dateCols = [], moneyCols = [], textCols = [];
    for (let c = 0; c < width; c++) {
      const vals = sample.map((r) => r[c]).filter(Boolean);
      if (!vals.length) continue;
      if (vals.every((v) => parseDateStr(v, order))) dateCols.push(c);
      else if (vals.every(isMoney)) moneyCols.push(c);
      else textCols.push(c);
    }
    m.date = dateCols[0] ?? 0;
    const avgLen = (c) => sum(sample, (r) => (r[c] || '').length);
    m.desc = textCols.length ? [textCols.sort((a, b) => avgLen(b) - avgLen(a))[0]] : [];
    const filled = (c) => sample.filter((r) => r[c]).length;
    if (moneyCols.length >= 3) { [m.debit, m.credit, m.balance] = moneyCols; }
    else if (moneyCols.length === 2) {
      const [a, b] = moneyCols;
      const both = sample.filter((r) => r[a] && r[b]).length;
      if (both === 0) { m.debit = a; m.credit = b; }
      else { m.amount = filled(a) >= filled(b) ? a : b; m.balance = m.amount === a ? b : a; }
    } else if (moneyCols.length === 1) m.amount = moneyCols[0];
  }
  return m;
}

/* ---------- Turning rows into candidate transactions ---------- */
function extractRows(a) {
  const { headers, rows, format, mapping } = a;
  const col = (name) => headers.map(H).indexOf(name);
  const out = [];
  if (format === 'wise-statement') {
    const c = {
      id: col('transferwise id') >= 0 ? col('transferwise id') : col('id'), date: col('date'), amount: col('amount'), cur: col('currency'),
      desc: col('description'), merchant: col('merchant'), payee: col('payee name'), payer: col('payer name'), bal: col('running balance'),
      exFrom: col('exchange from'), exTo: col('exchange to'), note: col('note'),
    };
    const order = detectDateOrder(rows.map((r) => r[c.date]));
    for (const r of rows) {
      const signed = parseMoney(r[c.amount]);
      const date = parseDateStr(r[c.date], order);
      if (!date || !Number.isFinite(signed) || signed === 0) continue;
      const desc = cleanDesc(r[c.merchant] || r[c.payee] || r[c.payer] || r[c.desc]);
      const isConversion = (r[c.exFrom] && r[c.exTo] && r[c.exFrom] !== r[c.exTo]) || /^converted|^exchanged/i.test(r[c.desc] || '');
      out.push({ date, desc: desc || 'Wise transaction', raw: r[c.desc] || '', amount: Math.abs(signed), dir: signed < 0 ? -1 : 1, currency: r[c.cur] || '', balance: parseMoney(r[c.bal]), extId: r[c.id] ? `wise:${r[c.id]}` : null, internal: isConversion });
    }
    return out;
  }
  if (format === 'wise-history') {
    const c = {
      id: col('id'), status: col('status'), dir: col('direction'), date: col('created on') >= 0 ? col('created on') : col('finished on'),
      srcName: col('source name'), srcAmt: headers.map(H).findIndex((h) => h.startsWith('source amount')), srcCur: col('source currency'),
      tgtName: col('target name'), tgtAmt: headers.map(H).findIndex((h) => h.startsWith('target amount')), tgtCur: col('target currency'),
      cat: col('category'), ref: col('reference'),
    };
    for (const r of rows) {
      const status = (r[c.status] || '').toUpperCase();
      if (status && !['COMPLETED', 'SUCCESSFUL', 'FUNDS_CONVERTED', 'OUTGOING_PAYMENT_SENT'].includes(status)) continue;
      const d = (r[c.dir] || '').toUpperCase();
      const date = parseDateStr(r[c.date], 'dmy');
      const isIn = d === 'IN';
      const amount = Math.abs(parseMoney(isIn ? r[c.tgtAmt] : r[c.srcAmt]));
      if (!date || !(amount > 0)) continue;
      out.push({
        date, desc: d === 'NEUTRAL' ? 'Currency conversion' : cleanDesc(isIn ? r[c.srcName] : r[c.tgtName]) || r[c.ref] || 'Wise transaction', raw: r[c.ref] || '',
        amount, dir: isIn ? 1 : -1, currency: (isIn ? r[c.tgtCur] : r[c.srcCur]) || '', balance: NaN,
        extId: r[c.id] ? `wise:${r[c.id]}` : null, internal: d === 'NEUTRAL', wiseCategory: H(r[c.cat]),
      });
    }
    return out;
  }
  // Generic + Wealthsimple
  const order = detectDateOrder(rows.slice(0, 200).map((r) => r[mapping.date]));
  for (const r of rows) {
    const date = parseDateStr(r[mapping.date], order);
    if (!date) continue;
    let amount = NaN, dir = 0;
    if (mapping.amount >= 0) {
      const v = parseMoney(r[mapping.amount]);
      if (Number.isFinite(v) && v !== 0) { amount = Math.abs(v); dir = (v < 0) === mapping.negIsOut ? -1 : 1; }
    } else {
      const d = parseMoney(r[mapping.debit]), cr = parseMoney(r[mapping.credit]);
      if (Number.isFinite(d) && d !== 0) { amount = Math.abs(d); dir = d < 0 ? 1 : -1; }
      else if (Number.isFinite(cr) && cr !== 0) { amount = Math.abs(cr); dir = cr < 0 ? -1 : 1; }
    }
    if (!(amount > 0)) continue;
    const desc = cleanDesc(mapping.desc.map((i) => r[i]).filter(Boolean).join(' · '));
    out.push({
      date, desc: desc || 'Transaction', raw: desc, amount, dir,
      currency: mapping.currency >= 0 ? r[mapping.currency] : '', balance: mapping.balance >= 0 ? parseMoney(r[mapping.balance]) : NaN,
      code: mapping.code >= 0 ? (r[mapping.code] || '').toUpperCase() : '', extId: null, internal: false,
    });
  }
  return out;
}

function investAccounts() { return state.accounts.filter((x) => isInvestKind(x.kind)); }

function suggest(row, ctx) {
  const key = merchantKey(row.desc);
  const text = `${row.desc} ${row.raw}`.toLowerCase();
  const inv = investAccounts();
  const learned = state.rules[key];
  if (learned && validChoice(learned, row)) return learned;
  if (row.internal) return 'skip';

  if (ctx.kind.startsWith('inv:')) {
    const acct = ctx.kind.slice(4);
    if (WS_CODES.dividend.includes(row.code) || /dividend/.test(text)) return 'income|Dividends';
    if (WS_CODES.interest.includes(row.code) || /interest/.test(text)) return 'income|Interest';
    if (WS_CODES.internal.includes(row.code) || INVEST_INTERNAL.test(text)) return 'skip';
    return row.dir > 0 ? `invest|${acct}` : 'skip';
  }

  if (row.dir < 0 && TO_INVESTMENT.test(text)) return inv.length ? `invest|${guessInvestAccount(text, inv).id}` : 'skip';
  if (row.code) {
    if (WS_CODES.interest.includes(row.code)) return 'income|Interest';
    if (WS_CODES.dividend.includes(row.code)) return 'income|Dividends';
    if (WS_CODES.internal.includes(row.code)) return 'skip';
  }
  if (OWN_TRANSFER.test(text)) return 'skip';
  if (row.wiseCategory && WISE_CATEGORIES[row.wiseCategory] && row.dir < 0) return `expense|${WISE_CATEGORIES[row.wiseCategory]}`;
  for (const [re, type, cat] of KEYWORD_RULES) {
    if (re.test(text) && (type === 'income') === (row.dir > 0)) return `${type}|${cat}`;
  }
  return row.dir > 0 ? 'income|Other' : 'expense|Other';
}
function guessInvestAccount(text, inv) {
  return inv.find((a) => text.includes(a.name.toLowerCase())) || inv.find((a) => /tfsa|rrsp|fhsa|celi|reer/.test(text) && /tfsa|rrsp|fhsa|celi|reer/i.test(a.name)) || inv[0];
}
function validChoice(choice, row) {
  if (choice === 'skip') return true;
  const [type, val] = choice.split('|');
  if (type === 'invest') return !!accountById(val);
  if (type === 'income') return row.dir > 0;
  return row.dir < 0;
}

/* ---------- Import session ---------- */
let imp = null;

function startImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv,text/comma-separated-values,application/vnd.ms-excel,text/plain';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = () => {
    const file = input.files[0];
    input.remove();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { beginReview(String(reader.result), file.name); }
      catch (e) { alert(`Couldn't read that file: ${e.message}`); }
    };
    reader.readAsText(file);
  };
  input.click();
}

const FORMAT_LABELS = { 'wise-statement': 'Wise statement', 'wise-history': 'Wise transaction history', wealthsimple: 'Wealthsimple activity', generic: 'Bank statement' };

function beginReview(text, filename) {
  const a = analyse(text);
  const lower = `${filename} ${a.format}`.toLowerCase();
  const source = /wise/.test(lower) ? 'Wise' : /wealthsimple|ws-|ws_/.test(lower) ? 'Wealthsimple' : '';
  imp = { ...a, filename, source, kind: 'spend', rates: {}, balanceTarget: '', items: [] };
  // Investment-account activity (buys, contributions, dividends) → suggest linking to an investment account
  const codes = a.format === 'wealthsimple' ? new Set(a.rows.map((r) => (r[a.mapping.code] || '').toUpperCase())) : new Set();
  const inv = investAccounts();
  if (inv.length && ['BUY', 'SELL', 'CONT', 'DIV'].some((c) => codes.has(c))) {
    imp.kind = `inv:${guessInvestAccount(filename.toLowerCase(), inv).id}`;
  }
  buildItems();
  // Suggest updating the matching cash account's balance
  if (imp.hasBalance) {
    const label = balanceAccountName().toLowerCase();
    const cash = state.accounts.filter((x) => x.kind === 'cash');
    const match = cash.find((x) => x.name.toLowerCase() === label) ||
      cash.find((x) => source && x.name.toLowerCase().includes(source.toLowerCase()) && (imp.balCurrency ? x.name.includes(imp.balCurrency) : !/\b[A-Z]{3}\b/.test(x.name)));
    imp.balanceTarget = match ? match.id : source ? 'new' : '';
  }
  drawImport();
}

// Name for a new cash account created from this file, e.g. "Wise" or "Wise USD"
function balanceAccountName() {
  return `${imp.source || 'Bank account'}${imp.balCurrency ? ` ${imp.balCurrency}` : ''}`;
}

function buildItems() {
  const prev = new Map(imp.items.map((i) => [i.key, i]));
  const rows = extractRows(imp);
  const home = state.settings.currency;
  const seen = {};
  imp.currencies = [...new Set(rows.map((r) => (r.currency || '').toUpperCase()).filter((c) => c && c !== home))];
  imp.hasBalance = imp.kind === 'spend' && rows.some((r) => Number.isFinite(r.balance));
  const balCur = (rows.find((r) => Number.isFinite(r.balance)) || {}).currency;
  imp.balCurrency = balCur && balCur.toUpperCase() !== home ? balCur.toUpperCase() : '';
  imp.items = rows.map((r) => {
    const cur = (r.currency || '').toUpperCase();
    const rate = !cur || cur === home ? 1 : parseAmount(imp.rates[cur]);
    const base = r.extId || `${r.date}|${r.dir}|${r.amount.toFixed(2)}|${merchantKey(r.desc)}`;
    seen[base] = (seen[base] || 0) + 1;
    const key = seen[base] > 1 ? `${base}#${seen[base]}` : base;
    const item = { ...r, key, cur, homeAmount: rate > 0 ? round2(r.amount * rate) : NaN, mkey: merchantKey(r.desc) };
    const old = prev.get(key);
    item.choice = old && old.userSet ? old.choice : suggest(item, imp);
    item.userSet = !!(old && old.userSet);
    item.already = !!state.importKeys[key];
    item.dupOf = item.already ? null : findExisting(item);
    item.include = old ? old.include : !item.already && !item.dupOf && item.choice !== 'skip';
    return item;
  });
  imp.items.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}

function findExisting(item) {
  if (!Number.isFinite(item.homeAmount)) return null;
  const d0 = parseISO(item.date).getTime();
  const near = (t) => Math.abs(t.amount - item.homeAmount) <= 0.005 && Math.abs(parseISO(t.date).getTime() - d0) <= 3 * 86400000;
  // The same contribution often shows up twice: leaving the bank file and arriving in the TFSA/RRSP file
  if (item.choice.startsWith('invest|')) return state.transactions.find((t) => t.type === 'invest' && near(t)) || null;
  return state.transactions.find((t) => {
    if (t.importKey) return false;
    if (Math.abs(t.amount - item.homeAmount) > 0.005) return false;
    if ((t.type === 'income') !== (item.dir > 0)) return false;
    return Math.abs(parseISO(t.date).getTime() - d0) <= 3 * 86400000;
  }) || null;
}

function choiceOptions(item) {
  const opts = [];
  const cats = item.dir > 0 ? CATS.income : CATS.expense;
  const label = item.dir > 0 ? 'Income' : 'Expense';
  opts.push(`<optgroup label="${label}">${cats.map(([c, e]) => `<option value="${item.dir > 0 ? 'income' : 'expense'}|${esc(c)}">${e} ${esc(c)}</option>`).join('')}</optgroup>`);
  const inv = investAccounts();
  if (inv.length) opts.push(`<optgroup label="Invest into">${inv.map((x) => `<option value="invest|${x.id}">📈 ${esc(x.name)}</option>`).join('')}</optgroup>`);
  opts.push('<option value="skip">🚫 Skip (transfer / not needed)</option>');
  return opts.join('').replace(`value="${esc(item.choice)}"`, `value="${esc(item.choice)}" selected`);
}

function importCounts() {
  const sel = imp.items.filter((i) => i.include && i.choice !== 'skip' && Number.isFinite(i.homeAmount));
  return {
    selected: sel.length,
    already: imp.items.filter((i) => i.already).length,
    dups: imp.items.filter((i) => i.dupOf).length,
    skipped: imp.items.filter((i) => i.choice === 'skip').length,
    needRate: imp.items.filter((i) => !Number.isFinite(i.homeAmount)).length,
  };
}

function columnSelect(field, value, allowNone = true) {
  const opts = imp.headers.map((h, i) => {
    const sample = (imp.rows.find((r) => r[i]) || [])[i] || '';
    const name = h || `Column ${i + 1}`;
    return `<option value="${i}" ${value === i ? 'selected' : ''}>${esc(name)}${sample ? ` — ${esc(sample.slice(0, 18))}` : ''}</option>`;
  });
  return `<select data-map="${field}">${allowNone ? `<option value="-1">—</option>` : ''}${opts.join('')}</select>`;
}

function drawImport() {
  const c = importCounts();
  const home = state.settings.currency;
  const m = imp.mapping;
  const inv = investAccounts();
  let h = `<div class="sheet-head"><button class="btn-text" data-sheet="cancel">Cancel</button><h3>Import</h3><button class="btn-text" data-sheet="save">Import${c.selected ? ` (${c.selected})` : ''}</button></div>`;
  h += `<div class="card" style="margin-top:4px">
    <div class="card-title">${esc(FORMAT_LABELS[imp.format])}${imp.source && !FORMAT_LABELS[imp.format].includes(imp.source) ? ` · ${esc(imp.source)}` : ''}</div>
    <div style="font-size:15px">${imp.items.length} transactions found in <b>${esc(imp.filename)}</b>.</div>
    <div class="imp-stats">
      <span><b>${c.selected}</b> to import</span>
      ${c.already ? `<span><b>${c.already}</b> imported before</span>` : ''}
      ${c.dups ? `<span><b>${c.dups}</b> look like ones you logged</span>` : ''}
      ${c.skipped ? `<span><b>${c.skipped}</b> skipped</span>` : ''}
    </div>
  </div>`;

  h += `<div class="form-group">
    <div class="form-row"><label for="imp-kind">File is from</label><select id="imp-kind">
      <option value="spend" ${imp.kind === 'spend' ? 'selected' : ''}>Bank / spending account</option>
      ${inv.map((x) => `<option value="inv:${x.id}" ${imp.kind === `inv:${x.id}` ? 'selected' : ''}>Investment: ${esc(x.name)}</option>`).join('')}
    </select></div>
    ${imp.hasBalance ? `<div class="form-row"><label for="imp-bal">Update balance</label><select id="imp-bal">
      <option value="">Don't update</option>
      ${state.accounts.filter((x) => x.kind === 'cash').map((x) => `<option value="${x.id}" ${imp.balanceTarget === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}
      <option value="new" ${imp.balanceTarget === 'new' ? 'selected' : ''}>New account: ${esc(balanceAccountName())}</option>
    </select></div>` : ''}
    ${imp.currencies.map((cur) => `<div class="form-row"><label for="rate-${cur}">1 ${cur} =</label><input id="rate-${cur}" data-rate="${cur}" inputmode="decimal" placeholder="rate" value="${esc(imp.rates[cur] || '')}"><span class="rate-cap">${home}</span></div>`).join('')}
  </div>`;
  if (imp.kind !== 'spend') h += `<p class="form-hint">Deposits and contributions count as <b>invested</b> into this account. Buys, sells and fees inside the account are skipped.</p>`;
  else if (!inv.length && imp.format === 'wealthsimple') h += `<p class="form-hint">Importing a TFSA/RRSP/FHSA file? Add that account in the Invest tab first, then pick it above.</p>`;
  if (c.needRate) h += `<p class="form-hint" style="color:var(--warn)">Enter the exchange rate above to include ${c.needRate} foreign-currency transaction${c.needRate > 1 ? 's' : ''}.</p>`;

  if (imp.format === 'generic' || imp.format === 'wealthsimple') {
    h += `<details class="imp-map"${imp.items.length ? '' : ' open'}><summary>Columns${imp.items.length ? '' : ': nothing recognised yet, pick them here'}</summary>
      <div class="form-group">
        <div class="form-row"><label>Date</label>${columnSelect('date', m.date, false)}</div>
        <div class="form-row"><label>Description</label>${columnSelect('desc', m.desc[0] ?? -1)}</div>
        <div class="form-row"><label>Amount</label>${columnSelect('amount', m.amount)}</div>
        <div class="form-row"><label>Money out</label>${columnSelect('debit', m.debit)}</div>
        <div class="form-row"><label>Money in</label>${columnSelect('credit', m.credit)}</div>
        <div class="form-row"><label>Balance</label>${columnSelect('balance', m.balance)}</div>
        <div class="form-row"><label for="imp-neg">Negative = </label><select id="imp-neg">
          <option value="out" ${m.negIsOut ? 'selected' : ''}>Money out (bank account)</option>
          <option value="in" ${m.negIsOut ? '' : 'selected'}>Money in (credit card)</option></select></div>
      </div>
      <p class="form-hint">Use either <b>Amount</b> (one signed column) or <b>Money out / Money in</b>.</p>
    </details>`;
  }

  if (!imp.items.length) {
    h += emptyState('🤔', 'No transactions recognised. Check the columns above.');
  } else {
    h += `<div class="imp-toolbar"><button class="link" data-imp="all">Select all</button><button class="link" data-imp="none">Select none</button></div>`;
    h += `<div class="list">${imp.items.map((it, idx) => {
      const tag = it.already ? '<span class="imp-tag">Imported before</span>' : it.dupOf ? `<span class="imp-tag warn">Already logged?</span>` : '';
      const amt = Number.isFinite(it.homeAmount) ? money(it.homeAmount) : `${it.amount.toFixed(2)} ${it.cur}`;
      return `<div class="imp-row ${it.include ? '' : 'off'}" data-idx="${idx}">
        <input type="checkbox" class="imp-check" ${it.include ? 'checked' : ''} aria-label="Include">
        <div class="row-main">
          <div class="row-title">${esc(it.desc)}</div>
          <div class="row-sub">${esc(prettyDate(it.date))}${it.cur && it.cur !== home && Number.isFinite(it.homeAmount) ? ` · ${it.amount.toFixed(2)} ${it.cur}` : ''} ${tag}</div>
          <select class="imp-choice" aria-label="Category">${choiceOptions(it)}</select>
        </div>
        <div class="row-amt amt ${it.dir > 0 ? 'pos' : ''}">${it.dir > 0 ? '' : '−'}${esc(amt)}</div>
      </div>`;
    }).join('')}</div>`;
    h += `<p class="form-hint" style="margin:10px 4px">Changing a category teaches Ledger: similar transactions update now and are categorised that way in future imports.</p>`;
  }
  const scroll = sheetBody.scrollTop;
  if (sheet.hidden) openSheet(h, mountImport);
  else { sheetBody.innerHTML = h; mountImport(sheetBody); sheetBody.scrollTop = scroll; }
}

function mountImport(root) {
  root.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.imp) {
      const on = b.dataset.imp === 'all';
      imp.items.forEach((i) => { i.include = on && i.choice !== 'skip' && Number.isFinite(i.homeAmount); });
      drawImport(); return;
    }
    const act = b.dataset.sheet;
    if (act === 'cancel') { imp = null; closeSheet(); return; }
    if (act === 'save') commitImport();
  };
  root.onchange = (e) => {
    const t = e.target;
    const row = t.closest('.imp-row');
    if (row) {
      const it = imp.items[+row.dataset.idx];
      if (t.classList.contains('imp-check')) {
        it.include = t.checked;
        row.classList.toggle('off', !it.include);
        refreshCounts(root);
      } else if (t.classList.contains('imp-choice')) {
        it.choice = t.value; it.userSet = true; it.include = t.value !== 'skip' && Number.isFinite(it.homeAmount);
        // apply to similar rows the user hasn't touched
        let n = 0;
        imp.items.forEach((o) => {
          if (o !== it && !o.userSet && o.mkey && o.mkey === it.mkey && o.dir === it.dir && validChoice(it.choice, o)) {
            o.choice = it.choice;
            if (!o.already && !o.dupOf) o.include = it.include;
            n++;
          }
        });
        if (n) { drawImport(); toast(`Applied to ${n} similar`); }
        else { row.classList.toggle('off', !it.include); $('.imp-check', row).checked = it.include; refreshCounts(root); }
      }
      return;
    }
    if (t.id === 'imp-kind') { imp.kind = t.value; imp.items.forEach((i) => { i.userSet = false; }); imp.items = []; buildItems(); drawImport(); return; }
    if (t.id === 'imp-bal') { imp.balanceTarget = t.value; return; }
    if (t.dataset.rate) { imp.rates[t.dataset.rate] = t.value; buildItems(); drawImport(); return; }
    if (t.id === 'imp-neg') { imp.mapping.negIsOut = t.value === 'out'; imp.items = []; buildItems(); drawImport(); return; }
    if (t.dataset.map) {
      const v = +t.value, f = t.dataset.map;
      if (f === 'desc') imp.mapping.desc = v >= 0 ? [v] : [];
      else imp.mapping[f] = v;
      if (f === 'amount' && v >= 0) { imp.mapping.debit = -1; imp.mapping.credit = -1; }
      if ((f === 'debit' || f === 'credit') && v >= 0) imp.mapping.amount = -1;
      imp.items = []; buildItems(); drawImport();
    }
  };
}
function refreshCounts(root) {
  const c = importCounts();
  $('[data-sheet="save"]', root).textContent = `Import${c.selected ? ` (${c.selected})` : ''}`;
  const first = $('.imp-stats span b', root);
  if (first) first.textContent = c.selected;
}

function commitImport() {
  const chosen = imp.items.filter((i) => i.include && i.choice !== 'skip' && Number.isFinite(i.homeAmount));
  if (!chosen.length && !imp.balanceTarget) { toast('Nothing selected to import'); return; }
  let n = 0;
  const created = Date.now();
  for (const it of chosen) {
    const [type, val] = it.choice.split('|');
    addTxn({
      id: uid(), type, amount: it.homeAmount,
      category: type === 'invest' ? 'Investment' : val, accountId: type === 'invest' ? val : undefined,
      date: it.date, note: it.desc.slice(0, 80), created: created + n, importKey: it.key,
    });
    n++;
  }
  // Remember what was reviewed so overlapping statements don't show it again
  for (const it of imp.items) if (!it.dupOf && (chosen.includes(it) || it.choice === 'skip')) state.importKeys[it.key] = 1;
  // Learn from the categories the user picked
  for (const it of imp.items) if (it.userSet && it.mkey) state.rules[it.mkey] = it.choice;
  // Update the linked account balance from the latest row that has one
  let balMsg = '';
  if (imp.balanceTarget && imp.hasBalance) {
    const latest = extractRows(imp).filter((r) => Number.isFinite(r.balance)).sort((x, y) => (x.date < y.date ? 1 : -1));
    // statements list same-day rows newest-first or oldest-first; take the one the file lists last for that day if ascending
    const topDate = latest[0] && latest[0].date;
    const sameDay = latest.filter((r) => r.date === topDate);
    const fileAscending = imp.rows.length > 1 && extractRows(imp)[0].date <= extractRows(imp).slice(-1)[0].date;
    const pick = fileAscending ? sameDay[sameDay.length - 1] : sameDay[0];
    if (pick) {
      const cur = (pick.currency || '').toUpperCase();
      const rate = !cur || cur === state.settings.currency ? 1 : parseAmount(imp.rates[cur]);
      if (rate > 0) {
        let acct = accountById(imp.balanceTarget);
        if (imp.balanceTarget === 'new') {
          acct = { id: uid(), name: balanceAccountName(), kind: 'cash', value: 0, basis: 0 };
          state.accounts.push(acct);
        }
        acct.value = round2(pick.balance * rate);
        acct.updated = today();
        balMsg = ` · ${acct.name} balance updated`;
      }
    }
  }
  snapshot(); save();
  imp = null;
  closeSheet();
  ui.tab = 'activity'; ui.filter = 'all'; ui.query = '';
  if (chosen.length) ui.month = monthKey(chosen.map((i) => i.date).sort().pop());
  render();
  toast(`Imported ${n} transaction${n === 1 ? '' : 's'}${balMsg}`);
}
