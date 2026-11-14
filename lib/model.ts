// Radar-4 — the valuation model behind the Token Radar board, version 4.
//
// The board answers a single question: if a protocol with no token today
// launched one tomorrow, what would it be worth, and what should an Agent ID
// holder do to farm the launch? The answer comes only from the sealed
// snapshot's own figures — TVL, 7-day change, age since listing, and what the
// market already pays for issued tokens in the same category. No protocol
// name is ever hardcoded, so a new protocol scores on its numbers alone.
//
//   comparable multiple = median market-cap / TVL over the category's live tokens,
//     shrunk toward the global median with a prior of 2, clamped to [0.05, 5];
//     a lone live token's ratio is winsorized to the 90th percentile (2.9747)
//     BEFORE shrinkage, so one outlier cannot price a category; a category
//     with no live token uses the global median
//   growth    = 1 + clamp(change_7d, -50 %, +150 %) / 100 * 0.6
//   maturity  = 0.6 + 0.4 * min(age_days, 1460) / 1460
//   chains    = 1 + 0.04 * min(chains - 1, 5)
//   implied   = max(1, round(TVL * multiple * growth * maturity * chains)), capped $1e14
//
// Why the prior is 2 rather than 5, and why the clamp is 5 rather than 2.5
// (changed from radar-3): radar-3 threw away every thin category's evidence —
// 65 launch rows sat in categories with fewer than 2 live tokens and were all
// priced at the global median 0.2138, however strong their own category's
// proof was. The worst of it was Risk Curators: 34 launches, including the
// three biggest, and its only live token (Api3) trades at 2.97x TVL — radar-3
// priced them at 0.19x TVL anyway. Radar-4 uses a lone ratio, winsorized
// first so a single freak outlier (Rain, 400.2x) cannot set a price either.
// The winsorize is what keeps the model honest: without it, Prediction
// Market would price at the clamp, $1.59B for Polymarket; with it, $360.8M.
//
// A protocol whose token already trades has a market price, so its board
// value is its market cap, not a model estimate — and the board shows the
// model estimate next to the market cap as a calibration check. The board is
// therefore two populations on one scale: 342 pre-token protocols valued by
// the model, and the 128 traded tokens valued by the market. A row is
// never both.
//
// A protocol is a launch candidate ("Launch radar" view) only when it is
// pre-token AND passes the watchlist rule: it is not a bridge, a centralised
// exchange, a liquid-staking wrapper, a versioned pool, or a wrapped/staked
// token. Everything else pre-token is still on the board, flagged with the
// exact reason it is not a launch candidate, so the board never pretends a
// bridge or an exchange is a launch.

export const MODEL = {
  version: "radar-4",
  watchlist_floor_usd: 50_000_000,
  // A token's market cap is trusted only when both halves of the ratio exist.
  live_requires: "mcap_usd > 0 and tvl_usd > 0",
  // Prior weight: a category's median counts as 2 protocols against the global median.
  shrink_prior: 2,
  // Winsorize a lone ratio to this percentile before shrinkage.
  winsorize_p90: 2.9747,
  multiple: { clamp_low: 0.05, clamp_high: 5, min_live_comps: 1 },
  growth: { slope: 0.6, clip_low: -50, clip_high: 150 },
  maturity: { low: 0.6, high: 1.0, horizon_days: 1460, default_age_days: 365 },
  chains: { per_extra: 0.04, cap_extra: 5 },
  implied: { floor_usd: 1, cap_usd: 1e14 },
} as const;

export interface ProtocolSnapshot {
  slug: string;
  name: string;
  symbol: string | null;
  gecko_id: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
}

export interface Snapshot {
  as_of: string;
  protocols: ProtocolSnapshot[];
  watchlist: string[];
}

export interface CategoryComparable {
  category: string;
  live_count: number;
  // Median mcap/TVL of the category's live tokens; the global median when none.
  median_multiple: number;
  // The multiple the model actually used (winsorize, shrinkage, floor, clamp applied).
  used_multiple: number;
}

export interface ModelInput {
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  // Days the maturity factor was computed from (365 when the listing date is unknown).
  maturity_days: number;
  chains_count: number;
  category: string;
  comparable_multiple: number;
  comparable_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

export type TokenStatus = 'pre-token' | 'token';

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  // Value on the board: the model estimate for pre-token, the market cap for token rows.
  implied_value_usd: number;
  token_status: TokenStatus;
  // Pre-token + passes the watchlist rule. The "Launch radar" view is this set.
  launch: boolean;
  // Why a pre-token row is not a launch candidate; null when it is one or has a token.
  not_launch_reason: string | null;
  watchlisted: boolean;
  // The live market cap, only for token rows.
  mcap_usd: number | null;
  // The model estimate, only for token rows (a calibration check, never the board value).
  model_usd: number | null;
  // model_usd / mcap_usd, only for token rows.
  model_vs_market: number | null;
  model: ModelInput;
  farm_steps: string[];
}

/**
 * One traded token that sets a category's price. The comparables table is
 * ordered by market cap for lookup only — that order is a lookup order, not
 * a ranking, and the dashboard says so on the table itself.
 */
export interface TokenComparableRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  // The live market cap — the number that prices the board.
  mcap_usd: number;
  // What the model would price this token at, from its own TVL and category.
  model_usd: number;
  // model_usd / mcap_usd: how far the model sits from the market.
  model_vs_market: number;
}

/**
 * One protocol the board left out, with the exact reason. The table is the
 * audit trail for the excluded counts: every protocol the snapshot holds that
 * has no value anchor appears here once, ordered by TVL so the biggest
 * omission is the easiest to find.
 */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  reason: string;
}

export interface Radar {
  model_version: string;
  as_of: string;
  rows: RadarRow[];
  comparables: CategoryComparable[];
  // The unranked comparables table: traded tokens, ordered by market cap.
  comparables_table: TokenComparableRow[];
  // The audit trail for the excluded counts: every omitted protocol, with its reason.
  excluded_table: ExcludedRow[];
  global_median: number;
  launch_count: number;
  token_count: number;
  // Traded tokens in the comparables table (board rows too, valued by the market).
  comparables_count: number;
  excluded_count: number;
  excluded_reasons: { no_value_anchor: number; mcap_not_positive: number };
  watchlist: string[];
  top_launch: RadarRow[];
  total_board_value_usd: number;
  calibration: { token_rows: number; median_abs_log_ratio: number; within_2x: number };
}

/** Whole days between a yyyy-mm-dd date and the snapshot date, or null when either is missing. */
export function daysBetween(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const snapMs = Date.parse(`${asOf}T00:00:00Z`);
  const listedMs = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(snapMs) || Number.isNaN(listedMs)) return null;
  return Math.max(0, Math.floor((snapMs - listedMs) / 86_400_000));
}

export function median(xs: number[]): number {
  const ordered = [...xs].sort((a, b) => a - b);
  const len = ordered.length;
  if (len === 0) return 0;
  const mid = Math.floor(len / 2);
  if (len % 2 === 1) return ordered[mid]!;
  return (ordered[mid - 1]! + ordered[mid]!) / 2;
}

export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

export function clamp(n: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, n));
}

/** A traded token whose market cap and TVL are both real, positive numbers. */
export function isLiveComparable(protocol: ProtocolSnapshot): boolean {
  return (
    typeof protocol.mcap_usd === 'number' &&
    protocol.mcap_usd > 0 &&
    typeof protocol.tvl_usd === 'number' &&
    protocol.tvl_usd > 0 &&
    protocol.gecko_id !== null &&
    protocol.symbol !== null
  );
}

/** No token exists for this protocol yet: all three token fields are null. */
export function isPreToken(protocol: ProtocolSnapshot): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_OR_STAKED_NAME = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** The rule the watchlist was built on: launch candidates are real protocols, not wrappers. */
export function notLaunchReason(protocol: ProtocolSnapshot): string | null {
  const category = protocol.category ?? 'Other';
  if (EXCLUDED_CATEGORIES.has(category)) {
    if (category === 'CEX') return 'centralised exchange — not a token launch';
    if (category === 'Bridge' || category === 'Canonical Bridge') return 'bridge — a transfer service, not a protocol launch';
    return 'liquid-staking wrapper — the wrapped asset, not a new launch';
  }
  if (VERSIONED_NAME.test(protocol.name)) return 'versioned pool — a numbered release, not a fresh protocol';
  if (WRAPPED_OR_STAKED_NAME.test(protocol.name)) return 'wrapped or staked token — the wrapper, not a launch';
  if (EXCHANGE_PREFIX.test(protocol.name)) return 'exchange product — not a token launch';
  return null;
}

export function isLaunchCandidate(protocol: ProtocolSnapshot): boolean {
  return isPreToken(protocol) && notLaunchReason(protocol) === null;
}

/** Why a protocol with a token still has no value anchor: the two no-anchor reasons. */
export function noAnchorReason(protocol: ProtocolSnapshot): string {
  if (protocol.mcap_usd === null) return 'has a token but no market cap — the market has not priced it';
  return 'market cap of zero or less — not a real price';
}

/**
 * The multiple a category actually uses (radar-4 / S3w). A category with no
 * live token never sets its own price — it uses the global median. A category
 * with exactly one live token uses that token's ratio, winsorized to the 90th
 * percentile first (so Rain at 400.2x prices Prediction Market at 2.97x, not
 * at the clamp), then shrunk toward the global median with a prior of 2.
 * A thicker category blends its own median with the global median, the prior
 * weighing two protocols, then clamps the result into the model's band.
 */
export function shrinkMultiple(ratios: number[], medianMultiple: number, globalMedian: number): number {
  if (ratios.length === 0) return globalMedian;
  let blended: number;
  if (ratios.length === 1) {
    const winsorized = Math.min(ratios[0]!, MODEL.winsorize_p90);
    blended = (winsorized + MODEL.shrink_prior * globalMedian) / (1 + MODEL.shrink_prior);
  } else {
    blended = (ratios.length * medianMultiple + MODEL.shrink_prior * globalMedian) / (ratios.length + MODEL.shrink_prior);
  }
  return round4(clamp(blended, MODEL.multiple.clamp_low, MODEL.multiple.clamp_high));
}

/** The category's price, from its live tokens — or the global median when too thin. */
export function comparablesOf(protocols: ProtocolSnapshot[]): {
  comparables: CategoryComparable[];
  globalMedian: number;
} {
  const live = protocols.filter(isLiveComparable);
  const globalMedian = round4(median(live.map((p) => p.mcap_usd! / p.tvl_usd)));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const cat = p.category ?? 'Other';
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), p.mcap_usd! / p.tvl_usd]);
  }
  const categories = [...new Set(protocols.map((p) => p.category ?? 'Other'))].sort();
  const comparables: CategoryComparable[] = categories.map((category) => {
    const ratios = byCategory.get(category) ?? [];
    const medianMultiple = ratios.length > 0 ? round4(median(ratios)) : globalMedian;
    return {
      category,
      live_count: ratios.length,
      median_multiple: medianMultiple,
      used_multiple: shrinkMultiple(ratios, medianMultiple, globalMedian),
    };
  });
  return { comparables, globalMedian };
}

/** The growth factor for a 7-day change: clipped, then damped by the slope. */
export function growthMultiplierFor(change7d: number | null): number {
  const clipped = clamp(change7d ?? 0, MODEL.growth.clip_low, MODEL.growth.clip_high);
  return round4(1 + (clipped / 100) * MODEL.growth.slope);
}

/** The maturity factor for an age in days: 0.6 at listing, 1.0 after four years. */
export function maturityMultiplierFor(ageDays: number | null): number {
  const days = ageDays ?? MODEL.maturity.default_age_days;
  const span = MODEL.maturity.high - MODEL.maturity.low;
  return round4(MODEL.maturity.low + (span * Math.min(days, MODEL.maturity.horizon_days)) / MODEL.maturity.horizon_days);
}

/** The chain factor: a little more for each extra chain, capped at five extras. */
export function chainMultiplierFor(chainsCount: number): number {
  const extras = Math.min(Math.max(chainsCount - 1, 0), MODEL.chains.cap_extra);
  return round4(1 + MODEL.chains.per_extra * extras);
}

/** The full working of the model for one protocol — every input and factor. */
export function priceProtocol(p: ProtocolSnapshot, asOf: string, comparables: CategoryComparable[], globalMedian: number): {
  impliedUsd: number;
  input: ModelInput;
} {
  const category = p.category ?? 'Other';
  const comparable = comparables.find((c) => c.category === category);
  const multiple = comparable?.used_multiple ?? globalMedian;
  const comparableCount = comparable?.live_count ?? 0;
  const growthMultiplier = growthMultiplierFor(p.change_7d);
  const ageDays = daysBetween(asOf, p.listed_at);
  const maturityDays = ageDays ?? MODEL.maturity.default_age_days;
  const maturityMultiplier = maturityMultiplierFor(ageDays);
  const chainMultiplier = chainMultiplierFor(p.chains.length);
  const raw = p.tvl_usd * multiple * growthMultiplier * maturityMultiplier * chainMultiplier;
  const impliedUsd = Math.min(MODEL.implied.cap_usd, Math.max(MODEL.implied.floor_usd, Math.round(raw)));
  return {
    impliedUsd,
    input: {
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: ageDays,
      maturity_days: maturityDays,
      chains_count: p.chains.length,
      category,
      comparable_multiple: multiple,
      comparable_count: comparableCount,
      growth_multiplier: growthMultiplier,
      maturity_multiplier: maturityMultiplier,
      chain_multiplier: chainMultiplier,
    },
  };
}

/** The deposit the farm plans size around: a small position scaled to the protocol's TVL. */
export function planCapitalUsd(tvlUsd: number): number {
  if (tvlUsd >= 1e9) return 500;
  if (tvlUsd >= 1e8) return 250;
  if (tvlUsd >= 1e7) return 100;
  if (tvlUsd >= 1e6) return 25;
  return 10;
}

function dollars(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd}`;
}

/** A big figure with thousands separators: $2,753,981,495. */
function fmtUsd(usd: number): string {
  return `$${Math.round(usd).toLocaleString('en-US')}`;
}

/** A gas figure: $5 for a whole dollar, $0.15 / $0.50 otherwise. */
function fmtGas(usd: number): string {
  return usd % 1 === 0 ? `$${usd}` : `$${usd.toFixed(2)}`;
}

/**
 * USD gas per contract interaction, from rounded public fee ranges
 * (GasFeesCalc swap ranges, Jun 2026; growthepie median tx costs, Oct 2026).
 * The value used is the TOP of each range — conservative, so a reader's real
 * cost is usually lower. Unlisted chains default to $0.50, also conservative.
 */
const GAS_PER_CHAIN: Record<string, number> = {
  Ethereum: 5, Arbitrum: 0.3, Base: 0.15, Optimism: 0.2, Binance: 0.3, Polygon: 0.1,
  Avalanche: 0.2, Solana: 0.05, 'zkSync Era': 0.15, Linea: 0.1, Scroll: 0.1, Blast: 0.15,
  Mantle: 0.1, Mode: 0.1, Unichain: 0.15, Berachain: 0.2, Sonic: 0.1, Sui: 0.05,
  Aptos: 0.05, Near: 0.05, Tron: 0.1, Fantom: 0.1, Celo: 0.05, xDai: 0.1, Gnosis: 0.1,
  Metis: 0.1, 'Hyperliquid L1': 0.05, Monad: 0.05, Stellar: 0.05, Flare: 0.05, Ink: 0.1,
  Plasma: 0.1, Soneium: 0.1, 'World Chain': 0.1, Abstract: 0.1, Katana: 0.1, Sei: 0.05,
  Zora: 0.1, Fraxtal: 0.1, 'Polygon zkEVM': 0.1, Op_Bnb: 0.1, MegaETH: 0.05, Taiko: 0.1,
  Morph: 0.1, Lisk: 0.1, Boba: 0.1, Cronos: 0.1, Kava: 0.05, Moonbeam: 0.1, Aurora: 0.1,
  Harmony: 0.05, Fuse: 0.05, Canto: 0.05, Evmos: 0.1, Zircuit: 0.1, Manta: 0.1,
  Starknet: 0.1, 'Arbitrum Nova': 0.2, 'Cronos zkEVM': 0.1, Klaytn: 0.05, zkLink: 0.1, Aleo: 0.05,
};

function gasFor(chain: string): number {
  return GAS_PER_CHAIN[chain] ?? 0.5;
}

const VERB_FOR_CATEGORY: Record<string, { main: string; second: string }> = {
  Lending: {
    main: 'supply',
    second: 'borrow a small amount against the supply' },
  Dexs: {
    main: 'swap',
    second: 'add a small position to the deepest pool' },
  Yield: {
    main: 'deposit into the highest-APY vault',
    second: 'deposit into a second vault' },
  'Yield Aggregator': {
    main: 'deposit into the highest-APY vault',
    second: 'deposit into a second vault' },
  'Risk Curators': {
    main: 'deposit into a curated vault',
    second: 'deposit into a vault run by a second curator' },
  'Onchain Capital Allocator': {
    main: 'deposit into an allocation vault',
    second: 'check the allocation report and deposit into a second vault' },
  CDP: {
    main: 'open a collateralised position',
    second: 'mint a small amount against a second collateral' },
  Derivatives: {
    main: 'open a small position',
    second: 'open a second position on the opposite side' },
  'Basis Trading': {
    main: 'deposit into a basis vault',
    second: 'deposit into a second basis vault' },
  'Liquid Staking': {
    main: 'stake into the liquid-staking vault',
    second: 'stake a second tranche' },
  'Liquid Restaking': {
    main: 'restake into the vault',
    second: 'restake a second tranche' },
  Restaking: {
    main: 'restake into the vault',
    second: 'restake a second tranche' },
  RWA: {
    main: 'buy into the tokenised asset',
    second: 'buy into a second tokenised asset' },
  'Prediction Market': {
    main: 'take a small position on a market',
    second: 'take a position on a second market' },
  'NFT Marketplace': {
    main: 'list or buy a small item',
    second: 'place a bid on a second item' },
  Payments: {
    main: 'send a small payment through the app',
    second: 'send a second payment on another chain' },
  Privacy: {
    main: 'run a private transfer through the app',
    second: 'run a second private transfer' },
  Launchpad: {
    main: 'join the active launch',
    second: 'complete the launch quest' },
  Farm: {
    main: 'deposit into the farm',
    second: 'deposit into a second farm' },
  Synthetics: {
    main: 'mint a small synthetic position',
    second: 'mint a second synthetic' },
  Options: {
    main: 'buy a small option',
    second: 'sell a covered option' },
  Bridge: {
    main: 'bridge funds to a second chain',
    second: 'bridge funds back through a different route' },
  'Canonical Bridge': {
    main: 'bridge funds to the destination chain',
    second: 'bridge funds back through a different route' },
  CEX: {
    main: 'place a small spot trade on the exchange',
    second: 'trade a second pair' },
  'Stablecoin Issuer': {
    main: 'mint a small amount of the stablecoin',
    second: 'redeem a small amount' },
  Staking: {
    main: 'stake a small amount',
    second: 'stake a second tranche' },
  'AI Agents': {
    main: 'run the agent on a small task',
    second: 'run the agent on a second task' },
  'Anchor BTC': {
    main: 'mint a small amount of the anchored asset',
    second: 'redeem a small amount' },
  Chain: {
    main: 'bridge a small amount to the chain and use its app',
    second: 'run a second transaction on the chain' },
  DOR: {
    main: 'open a small rates position',
    second: 'open a second rates position' },
  Indexes: {
    main: 'buy a small amount of the index',
    second: 'buy a second index' },
  Insurance: {
    main: 'buy a small cover policy',
    second: 'buy cover for a second protocol' },
  'Interest Rate Derivatives': {
    main: 'open a small rates trade',
    second: 'open a second rates trade' },
  'OTC Marketplace': {
    main: 'place a small OTC order',
    second: 'place a second OTC order' },
  'Reserve Currency': {
    main: 'mint a small amount of the reserve asset',
    second: 'bond a small amount' },
  'Staking Pool': {
    main: 'stake into the pool',
    second: 'stake a second tranche' },
  'Token Locker': {
    main: 'lock a small amount',
    second: 'lock a second tranche' },
  'Uncollateralized Lending': {
    main: 'open a small uncollateralised loan',
    second: 'repay and open a second loan' },
};

function actionFor(protocol: ProtocolSnapshot): { main: string; second: string } {
  const fallback = {
    main: 'deposit into the main vault',
    second: 'use a second feature of the app',
  };
  return VERB_FOR_CATEGORY[protocol.category ?? ''] ?? fallback;
}

/** "Felix Vaults'" for a name ending in s, "Steakhouse Financial's" otherwise. */
function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/**
 * Ten concrete steps for a launch candidate, every step carrying cost + time.
 * Each step is built from the row's own numbers — its TVL, its implied value,
 * its rank, its listing date, its 7-day change, its chains and its category's
 * verbs — so no two plans on the board read the same: step 1, 7 and 10 carry
 * figures that are unique to the row, and steps 2–6 carry the (chain, verb,
 * gas) combination that belongs to it.
 */
export function farmStepsForLaunch(protocol: ProtocolSnapshot, asOf: string, launchRank: number, impliedUsd: number, watchlisted: boolean): string[] {
  const capital = planCapitalUsd(protocol.tvl_usd);
  const small = Math.max(5, Math.round(capital / 5));
  const half = Math.max(5, Math.round(capital / 2));
  const action = actionFor(protocol);
  const chains = protocol.chains;
  const primary = chains[0] ?? 'its main chain';
  const secondChain = chains[1];
  const gas1 = fmtGas(gasFor(primary));
  const gas2 = secondChain === undefined ? gas1 : fmtGas(gasFor(secondChain));
  const reserve = Math.max(2, Math.ceil(6 * gasFor(primary)));
  const rankClause = watchlisted ? `(launch rank #${launchRank}, on the $50M watchlist)` : `(launch rank #${launchRank})`;
  const chainText = chains.length <= 1
    ? `on ${primary} only`
    : `across ${chains.length} chains (${chains.slice(0, 3).join(', ')}${chains.length > 3 ? ` and ${chains.length - 3} more` : ''})`;
  const ageDays = daysBetween(asOf, protocol.listed_at);
  const ageText = protocol.listed_at === null || ageDays === null
    ? 'since an unreported listing date'
    : `since ${protocol.listed_at} (${ageDays} days)`;
  const changeText = protocol.change_7d === null
    ? 'its 7-day TVL change is unreported'
    : protocol.change_7d >= 0
      ? `its TVL is up ${protocol.change_7d.toFixed(1)}% over 7 days`
      : `its TVL is down ${Math.abs(protocol.change_7d).toFixed(1)}% over 7 days`;
  return [
    `Set up a fresh wallet for ${protocol.name} only and fund it with ${dollars(capital)} plus ${dollars(reserve)} kept aside for gas on ${primary}. ${protocol.name} holds ${fmtUsd(protocol.tvl_usd)} TVL ${chainText} and the board values a future token at ${fmtUsd(impliedUsd)} ${rankClause}. Cost: ${dollars(capital + reserve)} total. Time: 5 minutes.`,
    `On ${primary}, ${action.main} ${dollars(capital)} into ${protocol.name} through its own app and keep the receipt. Cost: ${dollars(capital)} plus about ${gas1} gas. Time: 15 minutes.`,
    `Then ${action.second} with ${dollars(small)} on ${primary} for ${protocol.name}. Cost: ${dollars(small)} plus about ${gas1} gas. Time: 10 minutes.`,
    secondChain === undefined
      ? `${protocol.name} runs on ${primary} only, so deepen the same-chain position instead: ${action.second} with ${dollars(half)} for ${protocol.name}. Cost: ${dollars(half)} plus about ${gas1} gas. Time: 15 minutes.`
      : `Repeat the main action — ${action.main} — on ${secondChain} with ${dollars(half)} for ${protocol.name} so the position is visible on two chains. Cost: ${dollars(half)} plus about ${gas2} gas. Time: 15 minutes.`,
    `Once a week, do one small real action in the app on ${primary} — ${action.main} with ${dollars(small)} for ${protocol.name} — so the wallet is not a one-day visitor. Cost: about ${gas1} gas per week. Time: 10 minutes per week.`,
    `Find ${possessive(protocol.name)} points or quest page from its own docs and finish one listed task for the ${protocol.category ?? 'Other'} programme on ${primary}. Cost: about ${gas1} gas. Time: 15 minutes.`,
    `Hold the position for at least 90 days without withdrawing — ${protocol.name} has run ${ageText} with no token, and ${changeText}. Cost: the ${dollars(capital)} stays deployed. Time: 90 days.`,
    `Read ${possessive(protocol.name)} docs for the token or points rules and confirm the contract address there — never trust a contract pasted in a chat. Cost: nothing. Time: 15 minutes.`,
    `When the claim opens, use only the claim link ${protocol.name} publishes on its own site; a claim that asks you to pay first is a scam. Cost: no fee to claim. Time: 10 minutes.`,
    `Write the wallet address, the ${dollars(capital)} deposit into ${protocol.name} and the dates in a farm log — the board values ${protocol.name} at ${fmtUsd(impliedUsd)} (launch rank #${launchRank}) — then unwind in reverse order if the token never comes. Cost: nothing. Time: 5 minutes.`,
  ];
}

/**
 * Ten concrete steps for a pre-token protocol that is NOT a launch candidate
 * (a bridge, an exchange, a wrapper). It is still on the board, and it still
 * gets a plan — but the plan is how to USE the protocol, not how to farm a
 * launch that does not exist. The detail view says so in plain words.
 */
export function farmStepsForPreToken(protocol: ProtocolSnapshot): string[] {
  const capital = planCapitalUsd(protocol.tvl_usd);
  const small = Math.max(5, Math.round(capital / 5));
  const half = Math.max(5, Math.round(capital / 2));
  const action = actionFor(protocol);
  const chainList = protocol.chains.filter((c) => c !== 'Ethereum').slice(0, 2);
  const otherChain = chainList[0] ?? 'a second chain the protocol supports';
  const holdDays = 90;
  return [
    `Set up a fresh wallet for this protocol only and fund it with ${dollars(capital)} plus ${dollars(15)} kept aside for gas. Cost: ${dollars(capital + 15)} total. Time: 5 minutes.`,
    `From that wallet, ${action.main} ${dollars(capital)} into ${protocol.name} on its main chain and keep the receipt. Cost: ${dollars(capital)} plus about $2 gas. Time: 15 minutes.`,
    `Then ${action.second} with ${dollars(small)}. Cost: ${dollars(small)} plus about $2 gas. Time: 10 minutes.`,
    `Use the protocol on ${otherChain}: repeat the main action there with ${dollars(half)} so the position is visible on two chains. Cost: ${dollars(half)} plus about $2 gas. Time: 15 minutes.`,
    `Once a week, do one small real action in the app — a swap, a supply or a claim — so the wallet is not a one-day visitor. Cost: about $2 gas per week. Time: 10 minutes per week.`,
    `Find the protocol's points page or quest page from its own docs and finish one listed task, such as a quiz or a social task. Cost: about $2 gas. Time: 15 minutes.`,
    `Hold the position for at least ${holdDays} days without withdrawing; airdrop snapshots reward patience, not one-day deposits. Cost: the ${dollars(capital)} stays deployed. Time: ${holdDays} days.`,
    `Read the protocol's own docs for the token or points rules and confirm the contract address there — never trust a contract pasted in a chat. Cost: nothing. Time: 15 minutes.`,
    `When the claim opens, use only the claim link the protocol publishes on its own site; a claim that asks you to pay first is a scam. Cost: no fee to claim. Time: 10 minutes.`,
    `Write the wallet address, the deposit amounts and the dates in a farm log, then unwind in reverse order if the token never comes. Cost: nothing. Time: 5 minutes.`,
  ];
}

/** Ten concrete steps for a protocol whose token already trades — the ongoing incentives. */
export function farmStepsForToken(protocol: ProtocolSnapshot): string[] {
  const capital = planCapitalUsd(protocol.tvl_usd);
  const small = Math.max(5, Math.round(capital / 5));
  const half = Math.max(5, Math.round(capital / 2));
  const action = actionFor(protocol);
  const token = protocol.symbol ?? 'the token';
  return [
    `Set up a fresh wallet for this protocol only and fund it with ${dollars(capital)} plus ${dollars(15)} kept aside for gas. Cost: ${dollars(capital + 15)} total. Time: 5 minutes.`,
    `Buy ${dollars(capital)} of ${token} on the chain where the protocol runs, through its own swap page or a decentralised exchange. Cost: ${dollars(capital)} plus about $5 gas and slippage. Time: 15 minutes.`,
    `Stake or provide liquidity with ${dollars(capital)} of ${token} in the protocol's own app and keep the receipt. Cost: ${dollars(capital)} plus about $2 gas. Time: 15 minutes.`,
    `Vote once in the next governance proposal with the staked position. Cost: about $2 gas. Time: 10 minutes.`,
    `Once a week, ${action.main} with ${dollars(small)} in the app so the wallet keeps earning incentives. Cost: ${dollars(small)} plus about $2 gas per week. Time: 10 minutes per week.`,
    `Open a second position of ${dollars(half)} — a different pool, vault or market — so the wallet is not single-position. Cost: ${dollars(half)} plus about $2 gas. Time: 15 minutes.`,
    `Hold the position for at least 30 days so the incentive snapshots see a long-lived user. Cost: the ${dollars(capital)} stays deployed. Time: 30 days.`,
    `Claim rewards only from the protocol's own rewards page; a claim link from a chat or an ad is not the protocol. Cost: about $2 gas to claim. Time: 10 minutes.`,
    `Track the position weekly: write down the reward rate and the token price, and note any loss from price moves. Cost: nothing. Time: 10 minutes per week.`,
    `Write the wallet address, the deposit amounts and the dates in a farm log, then unwind in reverse order if the incentives dry up. Cost: nothing. Time: 5 minutes.`,
  ];
}

/** One row of the excluded table: the protocol's name, category, TVL and reason. */
export function excludedRowFor(protocol: ProtocolSnapshot, reason: string): ExcludedRow {
  return { slug: protocol.slug, name: protocol.name, category: protocol.category ?? 'Other', tvl_usd: protocol.tvl_usd, reason };
}

export function buildRadar(snapshot: Snapshot): { board: RadarRow[]; radar: Radar } {
  const { comparables, globalMedian } = comparablesOf(snapshot.protocols);
  const onWatchlist = new Set(snapshot.watchlist);
  const rows: RadarRow[] = [];
  const comparablesTable: TokenComparableRow[] = [];
  const excludedTable: ExcludedRow[] = [];
  let excludedNoAnchor = 0;
  let excludedMcap = 0;
  // The protocol behind each row, so farm plans can be written after ranking:
  // a launch plan carries its launch rank, which only exists once ranked.
  const protocolBySlug = new Map<string, ProtocolSnapshot>();
  for (const p of snapshot.protocols) protocolBySlug.set(p.slug, p);
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) {
      const { impliedUsd, input } = priceProtocol(p, snapshot.as_of, comparables, globalMedian);
      const launch = notLaunchReason(p) === null;
      rows.push({
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category ?? 'Other',
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: input.age_days,
        implied_value_usd: impliedUsd,
        token_status: 'pre-token',
        launch,
        not_launch_reason: launch ? null : notLaunchReason(p),
        watchlisted: onWatchlist.has(p.slug),
        mcap_usd: null,
        model_usd: null,
        model_vs_market: null,
        model: input,
        farm_steps: [],
      });
    } else if (typeof p.mcap_usd === 'number' && p.mcap_usd > 0) {
      const { impliedUsd: modelUsd, input } = priceProtocol(p, snapshot.as_of, comparables, globalMedian);
      const vsMarket = round4(modelUsd / p.mcap_usd);
      rows.push({
        rank: 0,
        slug: p.slug,
        name: p.name,
        category: p.category ?? 'Other',
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: input.age_days,
        implied_value_usd: Math.min(MODEL.implied.cap_usd, Math.max(MODEL.implied.floor_usd, Math.round(p.mcap_usd))),
        token_status: 'token',
        launch: false,
        not_launch_reason: null,
        watchlisted: onWatchlist.has(p.slug),
        mcap_usd: p.mcap_usd,
        model_usd: modelUsd,
        model_vs_market: vsMarket,
        model: input,
        farm_steps: [],
      });
      comparablesTable.push({
        slug: p.slug,
        name: p.name,
        category: p.category ?? 'Other',
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        age_days: input.age_days,
        mcap_usd: p.mcap_usd,
        model_usd: modelUsd,
        model_vs_market: vsMarket,
      });
    } else if (p.mcap_usd === null) {
      excludedNoAnchor += 1;
      excludedTable.push(excludedRowFor(p, noAnchorReason(p)));
    } else {
      excludedMcap += 1;
      excludedTable.push(excludedRowFor(p, noAnchorReason(p)));
    }
  }
  // Rank by board value, ties broken by slug so the order is deterministic.
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  for (let i = 0; i < rows.length; i += 1) rows[i]!.rank = i + 1;
  // Launch rank: the position among launch candidates only, in the same order.
  let launchRank = 0;
  for (const r of rows) {
    if (!r.launch) continue;
    launchRank += 1;
    const p = protocolBySlug.get(r.slug)!;
    r.farm_steps = farmStepsForLaunch(p, snapshot.as_of, launchRank, r.implied_value_usd, r.watchlisted);
  }
  for (const r of rows) {
    if (r.farm_steps.length > 0) continue;
    const p = protocolBySlug.get(r.slug)!;
    r.farm_steps = r.token_status === 'token' ? farmStepsForToken(p) : farmStepsForPreToken(p);
  }
  // The comparables table is ordered by market cap for lookup only — that order
  // is not a ranking, and no row in it carries a rank.
  comparablesTable.sort((a, b) => b.mcap_usd - a.mcap_usd || a.slug.localeCompare(b.slug));
  // The excluded table is ordered by TVL, biggest omission first.
  excludedTable.sort((a, b) => b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
  const launchCount = rows.filter((r) => r.launch).length;
  const tokenCount = rows.filter((r) => r.token_status === 'token').length;
  const logRatios = comparablesTable
    .map((r) => Math.abs(Math.log(r.model_usd / r.mcap_usd)))
    .sort((a, b) => a - b);
  const medianLog = logRatios.length > 0 ? logRatios[Math.floor(logRatios.length / 2)]! : 0;
  const within2x = logRatios.length > 0 ? logRatios.filter((r) => r <= Math.log(2)).length / logRatios.length : 0;
  const radar: Radar = {
    model_version: MODEL.version,
    as_of: snapshot.as_of,
    rows,
    comparables,
    comparables_table: comparablesTable,
    excluded_table: excludedTable,
    global_median: globalMedian,
    launch_count: launchCount,
    token_count: tokenCount,
    comparables_count: comparablesTable.length,
    excluded_count: excludedNoAnchor + excludedMcap,
    excluded_reasons: { no_value_anchor: excludedNoAnchor, mcap_not_positive: excludedMcap },
    watchlist: snapshot.watchlist,
    top_launch: rows.filter((r) => r.launch).slice(0, 12),
    total_board_value_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    calibration: {
      token_rows: comparablesTable.length,
      median_abs_log_ratio: round4(medianLog),
      within_2x: round4(within2x),
    },
  };
  return { board: rows, radar };
}

/** The gate's own checks, run before anything is written: a board the gate refuses never ships. */
export function boardIssue(board: RadarRow[], snapshot: Snapshot): string | null {
  if (board.length < 400 || board.length > 600) return `board has ${board.length} rows, the gate wants 400-600`;
  const onWatchlist = new Set(snapshot.watchlist);
  const covered = board.filter((r) => onWatchlist.has(r.slug));
  if (covered.length !== snapshot.watchlist.length) return `board covers ${covered.length}/${snapshot.watchlist.length} of the watchlist`;
  const seenRanks = new Map<number, number>();
  for (const r of board) {
    if (r.rank < 1 || r.rank > board.length) return `row ${r.slug} has rank ${r.rank} outside 1..${board.length}`;
    if (seenRanks.has(r.rank)) return `rank ${r.rank} appears twice`;
    seenRanks.set(r.rank, 1);
  }
  for (let i = 1; i < board.length; i += 1) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `implied values rise at rank ${board[i]!.rank}`;
    if (board[i]!.implied_value_usd <= 0) return `row ${board[i]!.slug} has a non-positive implied value`;
  }
  const costRe = /cost:/i;
  const timeRe = /time:/i;
  for (const r of board) {
    if (r.farm_steps.length < 8 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps, the gate wants 8-12`;
    for (const step of r.farm_steps) {
      if (step.length < 20 || step.length > 600) return `${r.slug} has a farm step of ${step.length} chars, the gate wants 20-600`;
      if (!costRe.test(step) || !timeRe.test(step)) return `${r.slug} has a farm step without cost or time`;
    }
    if (r.token_status !== 'pre-token' && r.token_status !== 'token') return `${r.slug} has token status ${r.token_status}`;
    if (r.token_status === 'token' && r.mcap_usd === null) return `${r.slug} is a token row without a market cap`;
    if (r.token_status === 'pre-token' && r.mcap_usd !== null) return `${r.slug} is a pre-token row with a market cap`;
    if (r.launch && r.token_status !== 'pre-token') return `${r.slug} is a launch candidate with a token`;
    if (r.implied_value_usd > MODEL.implied.cap_usd) return `${r.slug} exceeds the implied-value cap`;
  }
  const launchRows = board.filter((r) => r.launch).length;
  if (launchRows < 100) return `only ${launchRows} launch candidates`;
  return null;
}

/** The snapshot on disk, checked against itself before the model touches it. */
export function parseSnapshot(text: string): Snapshot {
  const parsed = JSON.parse(text) as Snapshot;
  const missing = ['as_of', 'protocols', 'watchlist'].filter((key) => !(key in parsed));
  if (missing.length > 0) throw new Error(`Snapshot is missing these fields: ${missing.join(', ')}`);
  const slugs = new Set<string>();
  for (const p of parsed.protocols) {
    if (typeof p.slug !== 'string') throw new Error('Snapshot has a protocol with no slug');
    if (slugs.has(p.slug)) throw new Error(`Duplicate slug: ${p.slug}`);
    if (!Number.isFinite(p.tvl_usd) || p.tvl_usd < 0) throw new Error(`Bad TVL on ${p.slug}`);
    slugs.add(p.slug);
  }
  for (const slug of parsed.watchlist) {
    if (!slugs.has(slug)) throw new Error(`Watchlist slug missing from the snapshot: ${slug}`);
  }
  return parsed;
}

/** The dashboard's data file: window.RADAR, nothing else, no network anywhere. */
export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
