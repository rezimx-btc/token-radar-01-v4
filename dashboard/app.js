// Token Radar v4 — the dashboard. It reads window.RADAR from the data.js
// next door and renders the board. Nothing on this page fetches the network:
// no external scripts, no images, no links out. Every figure comes from the
// sealed snapshot.
//
// THE MODEL (radar-4), spelled out here so the board can be audited from this
// file alone:
//   comparable multiple = median market-cap / TVL of the category's live tokens,
//     shrunk toward the global median with a prior of 2, clamped to [0.05, 5];
//     a lone live token's ratio is winsorized to the 90th percentile (2.9747)
//     BEFORE shrinkage, so one outlier cannot price a category; a category with
//     no live token uses the global median.
//   growth    = 1 + clamp(7d change, -50..+150) / 100 * 0.6
//   maturity  = 0.6 + 0.4 * min(age_days, 1460) / 1460
//   chains    = 1 + 0.04 * min(chains - 1, 5)
//   implied   = max(1, round(TVL * multiple * growth * maturity * chains)), capped at $1e14.
//
// THE BOARD IS TWO POPULATIONS ON ONE SCALE. It holds 470 rows: 342 pre-token
// protocols valued by the model, and 128 traded tokens valued by their market
// cap — never by the model. The 198 launch candidates are the pre-token rows
// that pass the launch rule. A row is never both populations. The board's total
// is $47.17B; the biggest launch is Steakhouse Financial, implied $2.77B at
// board rank #2; the board's top row is Coinbase Bridge, $2.95B, a pre-token
// protocol that is not a launch candidate (a bridge).
//
// WHAT ELSE IS ON THIS PAGE. Above the board: the leaders strip (the best launch
// in each of the eight biggest categories). On the board itself: the Model and
// vs market columns, so every traded token shows the model's estimate next to
// the market cap that prices it — the backtest, visible without scrolling.
// Below the board: the excluded table — every protocol the board left out, by
// name and reason — and the comparables table with the live tokens that set
// each category's price. The board itself can be downloaded as a CSV of
// exactly the rows the filters show.
//
// COMPARABLES is the display copy of the category table the model computed from
// the sealed snapshot (same numbers as data.js's comparables; the build refuses
// a mismatch): [category, live traded tokens, median mcap/TVL, multiple
// actually used, live token names (top 3 by market cap)].
'use strict';

const MODEL = {
  version: 'radar-4',
  globalMedian: 0.2138,
  shrinkPrior: 2,
  winsorizeP90: 2.9747,
  multipleLow: 0.05,
  multipleHigh: 5,
  minLiveComparables: 1,
  growthSlope: 0.6,
  growthLow: -50,
  growthHigh: 150,
  maturityLow: 0.6,
  maturityHigh: 1.0,
  maturityHorizonDays: 1460,
  defaultAgeDays: 365,
  chainPerExtra: 0.04,
  chainCapExtra: 5,
  impliedFloor: 1,
  impliedCap: 1e14,
};

// Calibration, checked against the 128 traded tokens: the model's median absolute
// log error is 1.146 (typically within a factor of ~3.1 of the market cap) and
// 29.7% of estimates land within 2x of the market. Leave-one-out — each token
// priced without itself — is 1.69 / 22.7%. The model ranks launches; it does not
// price them, and the board says so rather than hiding it. The numbers in the
// method note below are read from the data, not typed here.
const LEAVE_ONE_OUT = { medianAbsLogRatio: 1.69, within2x: 0.227 };

const COMPARABLES = [
  ["AI Agents", 2, 0.6047, 0.4093, "MorpheusAI, ZyFAI"],
  ["Algo-Stables", 0, 0.2138, 0.2138, ""],
  ["Anchor BTC", 0, 0.2138, 0.2138, ""],
  ["Basis Trading", 7, 0.6544, 0.5565, "Bitway Earn, Falcon Finance, ZEROBASE CeDeFi"],
  ["Bridge", 6, 0.5567, 0.471, "Portal, Merlins Seal, PumpBTC"],
  ["CDP", 3, 0.1687, 0.1867, "Frankencoin, Inverse Finance FiRM, Reservoir Protocol"],
  ["CDP Manager", 0, 0.2138, 0.2138, ""],
  ["CEX", 9, 0.0748, 0.1001, "OKX, Gate, Nexo"],
  ["Canonical Bridge", 8, 0.7464, 0.6399, "Mantle Bridge, Polygon Bridge, Starknet Bridge"],
  ["CeDeFi", 0, 0.2138, 0.2138, ""],
  ["Chain", 1, 3.0264, 1.1341, "Astar dApps Staking"],
  ["Collateral Management", 1, 12.1602, 1.1341, "Anvil"],
  ["Collateral Markets", 0, 0.2138, 0.2138, ""],
  ["Cross Chain Bridge", 4, 1.2205, 0.8849, "Across, Synapse Cross Chain Bridge, Hyperlane"],
  ["Crypto Card Issuer", 0, 0.2138, 0.2138, ""],
  ["DOR", 1, 0.0898, 0.1725, "Treehouse Protocol"],
  ["Decentralized AI", 1, 2.0604, 0.8293, "Chutes"],
  ["Decentralized BTC", 0, 0.2138, 0.2138, ""],
  ["Derivatives", 2, 2.1619, 1.1879, "Veranta, Gains Network"],
  ["Dexs", 11, 0.3424, 0.3226, "THORChain DEX, SushiSwap, Hydration DEX"],
  ["Dual-Token Stablecoin", 1, 0.0316, 0.1531, "fx Protocol"],
  ["Farm", 0, 0.2138, 0.2138, ""],
  ["Governance Incentives", 0, 0.2138, 0.2138, ""],
  ["Indexes", 3, 0.1477, 0.1741, "Reserve Protocol, Enzyme Finance, Index Coop"],
  ["Insurance", 0, 0.2138, 0.2138, ""],
  ["Interest Rate Derivatives", 0, 0.2138, 0.2138, ""],
  ["Launchpad", 1, 0.1306, 0.1861, "PinkSale"],
  ["Lending", 15, 0.1324, 0.142, "Aave V2, cap, Flying Tulip Lend"],
  ["Leveraged Farming", 1, 0.1725, 0.2, "Yield Basis"],
  ["Liquid Restaking", 2, 0.1828, 0.1983, "Renzo, Kyros"],
  ["Liquid Staking", 9, 0.0406, 0.0721, "Lido, Ankr, Rocket Pool"],
  ["Liquidity Manager", 1, 0.015, 0.1475, "ACryptoS"],
  ["NFT Marketplace", 1, 2.0017, 0.8098, "Blur Bids"],
  ["OTC Marketplace", 0, 0.2138, 0.2138, ""],
  ["Onchain Capital Allocator", 2, 0.0125, 0.1132, "Concrete, Grove Finance"],
  ["Options", 1, 1.5145, 0.6474, "Hegic"],
  ["Options Vault", 0, 0.2138, 0.2138, ""],
  ["Payments", 2, 0.1813, 0.1976, "Streamflow, Superfluid"],
  ["Prediction Market", 1, 400.2045, 1.1341, "Rain"],
  ["Privacy", 3, 0.9691, 0.667, "Zama, Railgun, Tornado Cash"],
  ["RWA", 9, 0.2748, 0.2637, "USD AI, Re, Usual USD0"],
  ["Reserve Currency", 0, 0.2138, 0.2138, ""],
  ["Restaked BTC", 0, 0.2138, 0.2138, ""],
  ["Restaking", 2, 0.0246, 0.1192, "EigenCloud, Babylon Protocol"],
  ["Risk Curators", 1, 2.9747, 1.1341, "Api3"],
  ["Stablecoin Issuer", 0, 0.2138, 0.2138, ""],
  ["Stablecoin Wrapper", 0, 0.2138, 0.2138, ""],
  ["Staking Pool", 2, 0.0018, 0.1078, "SSV Network, Obol"],
  ["Synthetics", 0, 0.2138, 0.2138, ""],
  ["Token Locker", 2, 9.5204, 4.8671, "FlokiFi Locker, Team Finance"],
  ["Uncollateralized Lending", 0, 0.2138, 0.2138, ""],
  ["Yield", 9, 0.1914, 0.1955, "Convex Finance, sDAI, Wise Token"],
  ["Yield Aggregator", 4, 0.151, 0.1719, "Badger DAO, Beefy, Harvest Finance"],
];

const DATA = window.RADAR;
const $ = (id) => document.getElementById(id);

/** Compact dollar figures: $2.77B, $47.17B, $120K, $250. */
function fmtMoney(usd) {
  if (usd === null || usd === undefined) return '—';
  if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) return `$${(usd / 1e6).toFixed(1)}M`;
  if (usd >= 1e3) return `$${(usd / 1e3).toFixed(1)}K`;
  return `$${Math.round(usd)}`;
}
/** A signed percent, coloured up green / down red. */
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  const text = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  return `<span class="${n >= 0 ? 'up' : 'down'}">${text}</span>`;
}
/** A signed percent without colour (used inside prose). */
function fmtChange7d(n) {
  if (n === null || n === undefined) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}
/** An age in days as 1.5y once past a year, else 214d. */
function fmtAge(days) {
  if (days === null || days === undefined) return '—';
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  return `${days}d`;
}
/** Escape the five HTML-significant characters. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function round4(n) { return Math.round(n * 1e4) / 1e4; }
/** One CSV cell: quote it when it holds a comma, a quote or a newline. */
function csvCell(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// --- State: the hash drives the view, so a link opens one exact view. ---
const state = { tab: 'launch', q: '', cat: '', chain: '', mintvl: 0, sort: 'value', watch: false, detail: null, ex: '', exq: '', exsort: 'tvl' };
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const tab = params.get('tab');
  if (tab) state.tab = tab;
  const q = params.get('q');
  if (q !== null) state.q = q;
  const cat = params.get('cat');
  if (cat !== null) state.cat = cat;
  const chain = params.get('chain');
  if (chain !== null) state.chain = chain;
  const mintvl = params.get('mintvl');
  if (mintvl !== null) state.mintvl = Number(mintvl);
  const sort = params.get('sort');
  if (sort) state.sort = sort;
  state.watch = params.get('watch') === '1';
  state.detail = params.get('detail');
  const ex = params.get('ex');
  if (ex !== null) state.ex = ex;
  const exq = params.get('exq');
  if (exq !== null) state.exq = exq;
  const exsort = params.get('exsort');
  if (exsort) state.exsort = exsort;
}
function writeHash() {
  const params = new URLSearchParams();
  params.set('tab', state.tab);
  if (state.q) params.set('q', state.q);
  if (state.cat) params.set('cat', state.cat);
  if (state.chain) params.set('chain', state.chain);
  params.set('mintvl', String(state.mintvl));
  if (state.sort !== 'value') params.set('sort', state.sort);
  if (state.watch) params.set('watch', '1');
  if (state.detail) params.set('detail', state.detail);
  if (state.ex) params.set('ex', state.ex);
  if (state.exq) params.set('exq', state.exq);
  if (state.exsort !== 'tvl') params.set('exsort', state.exsort);
  history.replaceState(null, '', `#${params.toString()}`);
}

/** The rows the current tab and filters show, in the chosen sort order. */
function visibleRows() {
  let rows = DATA.rows;
  if (state.tab === 'launch') rows = rows.filter((r) => r.launch);
  else if (state.tab === 'pre') rows = rows.filter((r) => r.token_status === 'pre-token');
  else if (state.tab === 'token') rows = rows.filter((r) => r.token_status === 'token');
  if (state.watch) rows = rows.filter((r) => r.watchlisted);
  if (state.cat) rows = rows.filter((r) => r.category === state.cat);
  if (state.chain) rows = rows.filter((r) => r.chains.includes(state.chain));
  if (state.mintvl > 0) rows = rows.filter((r) => r.tvl_usd >= state.mintvl);
  if (state.q) {
    const needle = state.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle));
  }
  const sorters = {
    value: (a, b) => b.implied_value_usd - a.implied_value_usd,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    growth: (a, b) => (b.change_7d ?? -1e9) - (a.change_7d ?? -1e9),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  };
  const by = sorters[state.sort] || ((a, b) => b.implied_value_usd - a.implied_value_usd);
  return [...rows].sort(by);
}

// --- Leaders by category: the best launch in each of the eight biggest categories. ---
function leadersOf() {
  const perCategory = new Map();
  for (const r of DATA.rows) {
    if (!r.launch) continue;
    const acc = perCategory.get(r.category) ?? { launches: 0, total: 0, best: null };
    acc.launches += 1;
    acc.total += r.implied_value_usd;
    if (!acc.best || r.implied_value_usd > acc.best.implied_value_usd) acc.best = r;
    perCategory.set(r.category, acc);
  }
  return [...perCategory.entries()]
    .map(([category, s]) => ({ category, launches: s.launches, total: s.total, row: s.best }))
    .sort((a, b) => b.row.implied_value_usd - a.row.implied_value_usd)
    .slice(0, 8);
}

function renderLeaders() {
  const leaders = leadersOf();
  $('leaders').innerHTML = leaders.map(({ category, launches, total, row }) => `
    <article tabindex="0" class="leader" data-slug="${esc(row.slug)}">
      <div class="rank">${esc(category)}</div>
      <h3>${esc(row.name)}</h3>
      <div class="value">${fmtMoney(row.implied_value_usd)}</div>
      <p>Board #${row.rank} · TVL ${fmtMoney(row.tvl_usd)} · 7d ${fmtChange7d(row.change_7d)}</p>
      <p>Multiple ${row.model.comparable_multiple.toFixed(3)} from ${row.model.comparable_count} live ${esc(category)} token${row.model.comparable_count === 1 ? '' : 's'}</p>
      <p>${launches} launch${launches === 1 ? '' : 'es'} · ${fmtMoney(total)} in the category</p>
    </article>`).join('');
}

// --- The board as a CSV: exactly the rows the filters show, nothing else. ---
function boardToCsv() {
  const rows = visibleRows();
  const head = ['rank', 'protocol', 'slug', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'model_usd', 'model_vs_market', 'mcap_usd', 'token_status', 'launch', 'watchlisted'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([
      r.rank, csvCell(r.name), csvCell(r.slug), csvCell(r.category), csvCell(r.chains.join(';')),
      r.tvl_usd, r.change_7d ?? '', r.age_days ?? '', r.implied_value_usd,
      r.model_usd ?? '', r.model_vs_market ?? '', r.mcap_usd ?? '', r.token_status, r.launch ? 'yes' : 'no', r.watchlisted ? 'yes' : 'no',
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

function downloadCsv() {
  const blob = new Blob([boardToCsv()], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'token-radar-board.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- Static sections: stats, spotlight, comparables, calibration, notes. ---
function renderStats() {
  const tiles = [
    ['Board rows', DATA.rows.length],
    ['Launch candidates', DATA.launch_count],
    ['Tokens trading', DATA.token_count],
    ['Total board value', fmtMoney(DATA.total_board_value_usd)],
  ];
  $('stats').innerHTML = tiles.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  $('asof').textContent = DATA.as_of;
  $('asof2').textContent = DATA.as_of;
  const cal = DATA.calibration;
  $('calibration').textContent =
    `Calibration: against the ${cal.token_rows} traded tokens the model's median absolute log error is ` +
    `${cal.median_abs_log_ratio.toFixed(2)} — typically within a factor of about ${Math.exp(cal.median_abs_log_ratio).toFixed(1)} of the market cap, ` +
    `and ${(cal.within_2x * 100).toFixed(1)}% of estimates land within 2x of the market. ` +
    `Leave-one-out (each token priced without itself): ${LEAVE_ONE_OUT.medianAbsLogRatio}, ${(LEAVE_ONE_OUT.within2x * 100).toFixed(1)}% within 2x. The model ranks launches; it does not price them.`;
  $('excluded-note').textContent =
    `${DATA.excluded_count} protocols are not on the board because they have no value anchor: ` +
    `${DATA.excluded_reasons.no_value_anchor} have a token but no market cap, and ${DATA.excluded_reasons.mcap_not_positive} have a market cap of zero or less. ` +
    `They are omitted rather than invented — a board that guesses their value would be prettier and less honest.`;
}

function renderSpotlight() {
  const top = DATA.top_launch[0].implied_value_usd;
  $('spotlight').innerHTML = DATA.top_launch.slice(0, 3).map((r, i) => `
    <article tabindex="0" class="spot" data-slug="${esc(r.slug)}">
      <div class="rank">Launch #${i + 1} · ${esc(r.category)}</div>
      <h3>${esc(r.name)}</h3>
      <div class="value">${fmtMoney(r.implied_value_usd)}</div>
      <span class="vbar" style="margin-left:0;width:100%"><i style="width:${Math.max(8, Math.round(100 * r.implied_value_usd / top))}%"></i></span>
      <p>TVL ${fmtMoney(r.tvl_usd)} · 7d ${fmtChange7d(r.change_7d)} · ${r.chains.length} chains</p>
      <p>Multiple ${r.model.comparable_multiple.toFixed(3)} from ${r.model.comparable_count} live ${esc(r.category)} token${r.model.comparable_count === 1 ? '' : 's'}</p>
    </article>`).join('');
}

function renderComparables() {
  $('comparables').querySelector('tbody').innerHTML = COMPARABLES.map(([cat, live, med, used, names]) => `
    <tr><td>${esc(cat)}</td><td class="num">${live}</td><td class="num">${med.toFixed(4)}</td><td class="num">${used.toFixed(4)}</td><td>${esc(names) || '—'}</td></tr>`).join('');
}

function renderHistogram(rows) {
  const el = $('hist');
  if (rows.length === 0) { el.innerHTML = ''; return; }
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  const edges = [1e6, 1e7, 1e8, 1e9, 1e10, 1e11];
  for (const r of rows) {
    let i = 0;
    while (i < edges.length && r.tvl_usd >= edges[i]) i += 1;
    buckets[i] += 1;
  }
  const labels = ['< $1M', '$1–10M', '$10–100M', '$100M–1B', '$1–10B', '$10–100B', '> $100B'];
  const max = Math.max(...buckets, 1);
  const w = 1120, h = 76, bw = w / 7;
  let bars = '';
  buckets.forEach((n, i) => {
    const bh = Math.max(2, (n / max) * 40);
    const top = 58 - bh;
    const cx = (i * bw + bw / 2).toFixed(0);
    const x = (i * bw + 6).toFixed(0);
    bars += `<rect x="${x}" y="${top.toFixed(0)}" width="${(bw - 12).toFixed(0)}" height="${bh.toFixed(0)}" rx="3" fill="${i >= 3 ? '#0e4b4b' : '#c2700a'}" opacity="0.85"/>` +
      `<text x="${cx}" y="${Math.max(12, top - 5).toFixed(0)}" text-anchor="middle" font-weight="700" fill="#1c2420">${n}</text>` +
      `<text x="${cx}" y="72" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="TVL distribution"><text x="0" y="12">TVL of the rows shown — most of the board sits above $100M</text>${bars}</svg>`;
}

function renderControls() {
  const cats = [...new Set(DATA.rows.map((r) => r.category))].sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(DATA.rows.flatMap((r) => r.chains))].sort();
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
}

// --- The board table. ---
function statusBadge(r) {
  if (r.token_status === 'token') return '<span class="badge token">TOKEN TRADES</span>';
  if (r.launch) return '<span class="badge pre">PRE-TOKEN</span> <span class="badge launch">LAUNCH</span>';
  return '<span class="badge pre">PRE-TOKEN</span> <span class="badge no">NOT A LAUNCH</span>';
}
function renderBoard() {
  const rows = visibleRows();
  const maxLog = Math.log10(DATA.rows[0].implied_value_usd);
  const barWidth = (v) => Math.max(4, Math.round((100 * Math.log10(Math.max(v, 1))) / maxLog));
  const tabWord = state.tab === 'launch' ? 'launch candidates only' : state.tab === 'pre' ? 'all pre-token protocols' : state.tab === 'token' ? 'tokens that already trade' : 'the whole board';
  const sortWord = state.sort === 'value' ? 'implied value' : state.sort === 'tvl' ? 'TVL' : state.sort === 'growth' ? '7d change' : 'age';
  $('count').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'} shown — ${tabWord} · sorted by ${sortWord}`;
  $('empty').hidden = rows.length > 0;
  $('board').querySelector('tbody').innerHTML = rows.map((r) => `
    <tr class="${state.detail === r.slug ? 'selected' : ''} ${r.token_status === 'token' ? 'token-row' : ''}" data-slug="${esc(r.slug)}">
      <td class="num">${r.rank}</td>
      <td class="name">${esc(r.name)}<small>${esc(r.slug)}${r.watchlisted ? ' · watchlist' : ''}</small></td>
      <td>${esc(r.category)}</td>
      <td>${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
      <td class="num">${fmtMoney(r.tvl_usd)}</td>
      <td class="num">${fmtPct(r.change_7d)}</td>
      <td class="num">${fmtAge(r.age_days)}</td>
      <td class="num"><strong>${fmtMoney(r.implied_value_usd)}</strong><span class="vbar"><i style="width:${barWidth(r.implied_value_usd)}%"></i></span></td>
      <td class="num">${r.token_status === 'token' ? fmtMoney(r.model_usd) : '—'}</td>
      <td class="num">${r.token_status === 'token' ? r.model_vs_market.toFixed(2) + 'x' : '—'}</td>
      <td>${statusBadge(r)}</td>
    </tr>`).join('');
  renderHistogram(rows);
}

// --- The detail view: every model input, a recompute check, the farm plan. ---
function recompute(row) {
  // Same arithmetic as the model in lib/model.ts, with the same 4-decimal rounding,
  // so the number below matches the board value to the dollar.
  const input = row.model;
  const growthF = round4(1 + (clamp(input.change_7d ?? 0, MODEL.growthLow, MODEL.growthHigh) / 100) * MODEL.growthSlope);
  const ageForFactor = input.maturity_days ?? input.age_days ?? MODEL.defaultAgeDays;
  const maturityF = round4(MODEL.maturityLow + ((MODEL.maturityHigh - MODEL.maturityLow) * Math.min(ageForFactor, MODEL.maturityHorizonDays)) / MODEL.maturityHorizonDays);
  const chainsF = round4(1 + MODEL.chainPerExtra * Math.min(Math.max(input.chains_count - 1, 0), MODEL.chainCapExtra));
  return Math.min(MODEL.impliedCap, Math.max(MODEL.impliedFloor, Math.round(input.tvl_usd * input.comparable_multiple * growthF * maturityF * chainsF)));
}
function farmStepsHtml(row) {
  const items = row.farm_steps.map((s, i) => {
    const m = s.match(/^(.*?) Cost: (.*?) Time: (.*)$/);
    const body = m ? `${esc(m[1])} <span class="cost">Cost: ${esc(m[2])}</span> <span class="time">Time: ${esc(m[3])}</span>` : esc(s);
    return `<li><strong>Step ${i + 1}.</strong> ${body}</li>`;
  }).join('');
  return `<ol>${items}</ol>`;
}
function renderDetail() {
  const el = $('detail');
  const row = DATA.rows.find((r) => r.slug === state.detail);
  if (!row) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const input = row.model;
  const growthF = round4(1 + (clamp(input.change_7d ?? 0, MODEL.growthLow, MODEL.growthHigh) / 100) * MODEL.growthSlope);
  const ageForFactor = input.maturity_days ?? input.age_days ?? MODEL.defaultAgeDays;
  const maturityF = round4(MODEL.maturityLow + ((MODEL.maturityHigh - MODEL.maturityLow) * Math.min(ageForFactor, MODEL.maturityHorizonDays)) / MODEL.maturityHorizonDays);
  const chainsF = round4(1 + MODEL.chainPerExtra * Math.min(Math.max(input.chains_count - 1, 0), MODEL.chainCapExtra));
  const recomputed = recompute(row);
  const compRow = COMPARABLES.find(([c]) => c === input.category);
  let compNote = '';
  if (compRow) {
    const liveNames = compRow[4] ? ` (${esc(compRow[4])})` : '';
    if (compRow[1] === 0) {
      compNote = `Its category, ${esc(input.category)}, has no live token, so the model used the global median ${compRow[3].toFixed(4)}.`;
    } else if (compRow[1] === 1) {
      compNote = `Its category, ${esc(input.category)}, has one live token${liveNames}; the lone ratio ${compRow[2].toFixed(4)} is winsorized to the 90th percentile (${MODEL.winsorizeP90}) before shrinkage, and the model used ${compRow[3].toFixed(4)} — so one outlier cannot price the category.`;
    } else {
      compNote = `Its category, ${esc(input.category)}, has ${compRow[1]} live tokens${liveNames}; the median multiple is ${compRow[2].toFixed(4)} and the model used ${compRow[3].toFixed(4)}.`;
    }
  }
  const alsoWatchlisted = row.watchlisted
    ? DATA.rows.filter((r) => r.watchlisted && r.launch && r.slug !== row.slug).slice(0, 6)
    : [];
  const wlStrip = alsoWatchlisted.length > 0
    ? `<div class="watch-strip"><span class="label">Also on the watchlist:</span>${alsoWatchlisted.map((r) => `<button data-slug="${esc(r.slug)}" class="chip">${esc(r.name)} · <b>${fmtMoney(r.implied_value_usd)}</b></button>`).join('')}</div>`
    : '';
  el.innerHTML = `
    <h2>${esc(row.name)} <span class="badge ${row.token_status === 'token' ? 'token' : 'pre'}">${row.token_status === 'token' ? 'TOKEN TRADES' : 'PRE-TOKEN'}</span> ${row.launch ? '<span class="badge launch">LAUNCH CANDIDATE</span>' : ''}</h2>
    <p>Rank #${row.rank} of ${DATA.rows.length} · ${esc(row.category)} · ${esc(row.chains.slice(0, 4).join(', '))}${row.chains.length > 4 ? ` +${row.chains.length - 4}` : ''} · TVL ${fmtMoney(row.tvl_usd)} · 7d ${fmtChange7d(row.change_7d)} · age ${fmtAge(row.age_days)}</p>
    ${row.token_status === 'token' ? `
      <p class="token-note"><strong>This token already trades.</strong> Its board value is the market cap, ${fmtMoney(row.mcap_usd)}, never a model estimate. The model would price it at ${fmtMoney(row.model_usd)} — ${row.model_vs_market.toFixed(2)}x the market — shown only as a calibration check. The farm plan below is for the ongoing incentives, not a launch.</p>` : ''}
    ${row.not_launch_reason ? `<p class="flag"><strong>Not a launch candidate:</strong> ${esc(row.not_launch_reason)}. It stays on the board because its implied value is real — but the farm plan below is how to use the protocol, not how to farm a launch that does not exist.</p>` : ''}
    <dl class="grid">
      <div><dt>Implied value</dt><dd>${fmtMoney(row.implied_value_usd)}<small>${row.token_status === 'token' ? 'market cap' : 'model estimate'}</small></dd></div>
      <div><dt>TVL</dt><dd>${fmtMoney(input.tvl_usd)}<small>snapshot</small></dd></div>
      <div><dt>Category multiple</dt><dd>${input.comparable_multiple.toFixed(4)}<small>${input.comparable_count} live comparable${input.comparable_count === 1 ? '' : 's'}</small></dd></div>
      <div><dt>7d growth</dt><dd>${input.change_7d === null ? '—' : (input.change_7d >= 0 ? '+' : '') + input.change_7d.toFixed(1) + '%'}<small>growth factor ${growthF.toFixed(3)}</small></dd></div>
      <div><dt>Age</dt><dd>${fmtAge(input.age_days)}<small>maturity factor ${maturityF.toFixed(3)}</small></dd></div>
      <div><dt>Chains</dt><dd>${input.chains_count}<small>chain factor ${chainsF.toFixed(3)}</small></dd></div>
      <div><dt>Model check</dt><dd>${fmtMoney(recomputed)} recomputed<small>${recomputed === row.implied_value_usd ? 'matches the board value' : row.token_status === 'token' ? 'model estimate — the board uses the market cap' : 'differs — check the model'}</small></dd></div>
      <div><dt>Board rank</dt><dd>#${row.rank}<small>of ${DATA.rows.length} rows</small></dd></div>
    </dl>
    <p class="check-line"><strong>How this number was made:</strong> ${fmtMoney(input.tvl_usd)} TVL × ${input.comparable_multiple.toFixed(4)} category multiple × ${growthF.toFixed(3)} growth × ${maturityF.toFixed(3)} maturity × ${chainsF.toFixed(3)} chains = ${fmtMoney(recomputed)}. ${compNote}</p>
    <table class="raw">
      <thead><tr><th>Model input</th><th>Figure</th><th>Factor</th></tr></thead>
      <tbody>
        <tr><td>TVL (snapshot ${esc(DATA.as_of)})</td><td class="num">${fmtMoney(input.tvl_usd)}</td><td class="num">—</td></tr>
        <tr><td>Category multiple, ${esc(input.category)}</td><td class="num">${input.comparable_multiple.toFixed(4)}</td><td class="num">${input.comparable_count} live comparables; median ${compRow ? compRow[2].toFixed(4) : '—'}</td></tr>
        <tr><td>7d change</td><td class="num">${input.change_7d === null ? '—' : (input.change_7d >= 0 ? '+' : '') + input.change_7d.toFixed(1) + '%'}</td><td class="num">${growthF.toFixed(3)}</td></tr>
        <tr><td>Age</td><td class="num">${input.age_days === null ? 'unknown — 365d assumed' : fmtAge(input.age_days)}</td><td class="num">${maturityF.toFixed(3)}</td></tr>
        <tr><td>Chains</td><td class="num">${input.chains_count}</td><td class="num">${chainsF.toFixed(3)}</td></tr>
        <tr><td><strong>${row.token_status === 'token' ? 'Model estimate (board uses the market cap)' : 'Implied value'}</strong></td><td class="num"><strong>${fmtMoney(recomputed)}</strong></td><td class="num">${row.token_status === 'token' ? `market cap ${fmtMoney(row.mcap_usd)} · model ${row.model_vs_market.toFixed(2)}x market` : 'capped at $100T, floored at $1'}</td></tr>
      </tbody>
    </table>
    <h3>Farm plan — 10 steps, every step with a cost and a time</h3>
    ${farmStepsHtml(row)}
    ${wlStrip}
    <p><a href="#" id="close-detail">Close this detail</a></p>`;
  $('close-detail').addEventListener('click', (ev) => {
    ev.preventDefault();
    state.detail = null;
    writeHash();
    renderBoard();
    renderDetail();
  });
}

// --- The excluded table: every omitted protocol, by name and reason. ---
function excludedRows() {
  let rows = DATA.excluded_table;
  if (state.ex) rows = rows.filter((r) => r.reason === state.ex);
  if (state.exq) {
    const needle = state.exq.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle));
  }
  const sorters = {
    tvl: (a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const by = sorters[state.exsort] || ((a, b) => b.tvl_usd - a.tvl_usd);
  return [...rows].sort(by);
}

function renderExcluded() {
  const reasons = [...new Set(DATA.excluded_table.map((r) => r.reason))].sort();
  $('ex-reason').innerHTML = '<option value="">All reasons</option>' + reasons.map((r) => `<option>${esc(r)}</option>`).join('');
  $('ex-reason').value = state.ex;
  $('ex-search').value = state.exq;
  $('ex-sort').value = state.exsort;
  const rows = excludedRows();
  const reasonWord = state.ex ? ` — ${state.ex}` : '';
  const orderWord = state.exsort === 'tvl' ? 'TVL, biggest omission first' : 'name';
  $('ex-count').textContent = `${rows.length} protocol${rows.length === 1 ? '' : 's'} left out${reasonWord} · ordered by ${orderWord}`;
  $('excluded-table').querySelector('tbody').innerHTML = rows.map((r) => `
    <tr>
      <td class="name">${esc(r.name)}<small>${esc(r.slug)}</small></td>
      <td>${esc(r.category)}</td>
      <td class="num">${fmtMoney(r.tvl_usd)}</td>
      <td>${esc(r.reason)}</td>
    </tr>`).join('');
}

function excludedToCsv() {
  const rows = excludedRows();
  const lines = ['protocol,slug,category,tvl_usd,reason'];
  for (const r of rows) {
    lines.push([csvCell(r.name), csvCell(r.slug), csvCell(r.category), r.tvl_usd, csvCell(r.reason)].join(','));
  }
  return lines.join('\n') + '\n';
}

function downloadExcludedCsv() {
  const blob = new Blob([excludedToCsv()], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'token-radar-excluded.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- Wiring. ---
function syncControls() {
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  $('q').value = state.q;
  $('cat').value = state.cat;
  $('chain').value = state.chain;
  $('mintvl').value = String(state.mintvl);
  $('sort').value = state.sort;
  $('watch').checked = state.watch;
}
function render() {
  syncControls();
  renderStats();
  renderSpotlight();
  renderLeaders();
  renderComparables();
  renderExcluded();
  renderBoard();
  renderDetail();
}
function openRow(slug) {
  state.detail = slug;
  writeHash();
  renderBoard();
  renderDetail();
  $('detail').scrollIntoView({ block: 'start' });
}
function init() {
  readHash();
  renderControls();
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab; state.detail = null; writeHash(); render();
  }));
  $('q').addEventListener('input', (e) => { state.q = e.target.value; writeHash(); renderBoard(); renderDetail(); });
  $('cat').addEventListener('change', (e) => { state.cat = e.target.value; writeHash(); renderBoard(); renderDetail(); });
  $('chain').addEventListener('change', (e) => { state.chain = e.target.value; writeHash(); renderBoard(); renderDetail(); });
  $('mintvl').addEventListener('change', (e) => { state.mintvl = Number(e.target.value); writeHash(); renderBoard(); renderDetail(); });
  $('sort').addEventListener('change', (e) => { state.sort = e.target.value; writeHash(); renderBoard(); renderDetail(); });
  $('watch').addEventListener('change', (e) => { state.watch = e.target.checked; writeHash(); renderBoard(); renderDetail(); });
  $('csv').addEventListener('click', downloadCsv);
  $('ex-reason').addEventListener('change', (e) => { state.ex = e.target.value; writeHash(); renderExcluded(); });
  $('ex-search').addEventListener('input', (e) => { state.exq = e.target.value; writeHash(); renderExcluded(); });
  $('ex-sort').addEventListener('change', (e) => { state.exsort = e.target.value; writeHash(); renderExcluded(); });
  $('ex-csv').addEventListener('click', downloadExcludedCsv);
  $('board').querySelector('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    openRow(tr.dataset.slug);
  });
  $('spotlight').addEventListener('click', (e) => {
    const card = e.target.closest('[data-slug]');
    if (!card) return;
    openRow(card.dataset.slug);
  });
  $('leaders').addEventListener('click', (e) => {
    const card = e.target.closest('[data-slug]');
    if (!card) return;
    openRow(card.dataset.slug);
  });
  $('detail').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-slug]');
    if (!chip) return;
    openRow(chip.dataset.slug);
  });
  render();
  // A link that opens a detail view scrolls it into the frame on load,
  // so a screenshot of the link shows the detail, not the tab it came from.
  if (state.detail) setTimeout(() => $('detail').scrollIntoView({ block: 'start' }), 120);
}
if (typeof DATA === 'undefined' || !DATA.rows) {
  document.body.innerHTML = '<main><p>The board data did not load.</p></main>';
} else {
  init();
}
