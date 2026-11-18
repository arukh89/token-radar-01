// The pre-token radar's model: one sealed DefiLlama snapshot in, one ranked board out.
//
// The board ranks every protocol that records no token and is not a wrapped, staked or
// bridged product of a token that already trades, by an implied launch value fitted from
// the snapshot's own traded protocols. Nothing is hand-picked and no name is special-cased:
//
//   multiple   = the category's median market-cap/TVL ratio among traded comparables,
//                winsorised and shrunk toward the global median (see fitMultiples);
//                a category with fewer than 3 comparables takes the global median,
//                so one wild comparable can never set the board's values
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity))
//
// A leave-one-out backtest scores the same fit against the traded protocols it learned
// from, so the dashboard can state honestly how rough a multiple-based value is. The
// backtest's error spread sets each row's implied range. Farm plans are derived from
// each protocol's own record (category, chains, TVL, age): concrete steps with a cost
// and a time, never slogans.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's tunable constants, stated in the dashboard and changeable in its sandbox. */
export interface ModelParams {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  shrink_prior: number;
  min_category_comps: number;
  ratio_floor: number;
  ratio_cap: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const PARAMS: ModelParams = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  shrink_prior: 6,
  min_category_comps: 3,
  ratio_floor: 0.005,
  ratio_cap: 5,
  multiple_floor: 0.01,
  multiple_cap: 1.5,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-fit-1';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    multiple: number;
    comps_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm: {
    capital_usd: number;
    gas_usd: number;
    active_minutes: number;
    hold_days: number;
  };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** One fitted category multiple, with how many comparables support it. */
export interface CategoryFit {
  category: string;
  multiple: number;
  comps: number;
}

/** The leave-one-out backtest of the fit against the traded protocols. */
export interface Backtest {
  comps: number;
  median_abs_log_error: number;
  median_ratio: number;
  within_2x: number;
  low_factor: number;
  high_factor: number;
}

/** How every protocol in the snapshot is accounted for. */
export interface Coverage {
  total: number;
  watchlist: number;
  board: number;
  early: number;
  live_token: number;
  excluded: { reason: string; count: number }[];
}

/** Everything the dashboard needs: the board, the live set, the fit and the accounting. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  params: ModelParams;
  model_version: string;
  global_multiple: number;
  categories: CategoryFit[];
  backtest: Backtest;
  coverage: Coverage;
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list; the list is copied, never reordered. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A ratio clamped into the winsorising band, so one outlier cannot set a multiple. */
function winsorised(ratio: number, params: ModelParams): number {
  return Math.min(params.ratio_cap, Math.max(params.ratio_floor, ratio));
}

// ---------------------------------------------------------------- classification

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist rule treats as wrapped, staked or bridged products. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whole words in a name that mark a wrapped or staked product. */
const PRODUCT_WORDS = /\b(wrapped|staked|staking)\b/i;

/** Exchange names a wrapped or staked product's name begins with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is not rankable, or null when it is: the watchlist's own rule. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (VERSIONED.test(p.name)) return 'versioned name (a pool of another protocol)';
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (PRODUCT_WORDS.test(p.name)) return 'wrapped / staked product by name';
  const first = p.name.split(/\s+/)[0] ?? '';
  if (EXCHANGES.includes(first)) return 'exchange product by name';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped/staked product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

// ---------------------------------------------------------------- the fit

/** A traded comparable: a protocol with a market cap and TVL, in a category the fit can use. */
interface Comp {
  category: string;
  ratio: number;
  protocol: SnapshotProtocol;
}

/** The traded comparables the multiples are fitted from. */
export function comparables(snapshot: Snapshot, params: ModelParams): Comp[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !VERSIONED.test(p.name))
    .map((p) => ({ category: p.category ?? 'Other', ratio: winsorised(p.mcap_usd! / p.tvl_usd, params), protocol: p }));
}

/**
 * The fitted multiples: each category's median comparable ratio, shrunk toward the global
 * median with a prior of `shrink_prior` pseudo-comparables, so a category with one wild
 * comparable cannot set the board's values. Categories with fewer than
 * `min_category_comps` comparables take the global median outright. Multiples are
 * rounded to 4 places: the page recomputes from the same rounded number, so its
 * arithmetic and board.json always agree.
 */
export function fitMultiples(snapshot: Snapshot, params: ModelParams): { global: number; byCategory: Map<string, { multiple: number; comps: number }> } {
  const comps = comparables(snapshot, params);
  const global = round4(Math.min(params.multiple_cap, Math.max(params.multiple_floor, median(comps.map((c) => c.ratio)))));
  const byCategory = new Map<string, { multiple: number; comps: number }>();
  const groups = new Map<string, number[]>();
  for (const c of comps) {
    const list = groups.get(c.category) ?? [];
    list.push(c.ratio);
    groups.set(c.category, list);
  }
  for (const [category, ratios] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length < params.min_category_comps) {
      byCategory.set(category, { multiple: global, comps: ratios.length });
      continue;
    }
    const shrunk = (ratios.length * median(ratios) + params.shrink_prior * global) / (ratios.length + params.shrink_prior);
    byCategory.set(category, { multiple: round4(Math.min(params.multiple_cap, Math.max(params.multiple_floor, shrunk))), comps: ratios.length });
  }
  return { global, byCategory };
}

/** The multiple one protocol is scored with, and how many comparables support it. */
export function multipleFor(p: SnapshotProtocol, fit: { global: number; byCategory: Map<string, { multiple: number; comps: number }> }): { multiple: number; comps: number } {
  const hit = p.category === null ? undefined : fit.byCategory.get(p.category);
  if (hit !== undefined) return hit;
  const other = fit.byCategory.get('Other');
  return other !== undefined ? other : { multiple: fit.global, comps: 0 };
}

/** The growth and maturity multipliers one protocol gets under `params`. */
export function multipliers(p: SnapshotProtocol, asOf: string, params: ModelParams): { growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * params.growth_weight;
  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult = params.maturity_floor + (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days) * params.maturity_range;
  return { growthPct, growthMult, maturityMult, age };
}

/** The implied value one protocol gets: TVL x fitted multiple x growth x maturity. */
export function impliedValue(p: SnapshotProtocol, asOf: string, params: ModelParams, multiple: number): number {
  const { growthMult, maturityMult } = multipliers(p, asOf, params);
  return Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
}

/**
 * The leave-one-out backtest: each traded comparable is predicted from the multiples
 * fitted without it, and the prediction is compared with its real market cap. The
 * spread of predicted/actual ratios sets the board's implied range, so the range is
 * the fit's own measured error, not a guessed band.
 */
export function backtestFit(snapshot: Snapshot, params: ModelParams): Backtest {
  const comps = comparables(snapshot, params);
  const ratios: number[] = [];
  const logErrors: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const held = comps[i]!;
    const rest = comps.filter((_, j) => j !== i);
    const global = median(rest.map((c) => c.ratio));
    const same = rest.filter((c) => c.category === held.category).map((c) => c.ratio);
    const shrunk = same.length >= params.min_category_comps ? (same.length * median(same) + params.shrink_prior * global) / (same.length + params.shrink_prior) : global;
    const multiple = Math.min(params.multiple_cap, Math.max(params.multiple_floor, shrunk));
    const predicted = impliedValue(held.protocol, snapshot.as_of, params, round4(multiple));
    const actual = held.protocol.mcap_usd!;
    const ratio = predicted / actual;
    ratios.push(ratio);
    logErrors.push(Math.abs(Math.log(ratio)));
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  const q = (f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]!;
  return {
    comps: comps.length,
    median_abs_log_error: round4(median(logErrors)),
    median_ratio: round4(median(ratios)),
    within_2x: round4(ratios.filter((r) => r >= 0.5 && r <= 2).length / Math.max(1, ratios.length)),
    low_factor: round4(Math.min(1, Math.max(0.25, q(0.25)))),
    high_factor: round4(Math.max(1, Math.min(4, q(0.75)))),
  };
}

// ---------------------------------------------------------------- farm plans

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** Whether the protocol's main chain is Ethereum mainnet, where gas costs far more than elsewhere. */
function isMainnet(chain: string): boolean {
  return chain.toLowerCase() === 'ethereum';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a small amount against it, then repay the borrow.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and stake the LP receipt if the app offers it.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in the destination app it points to.`;
  if (c.includes('liquid restak') || c.includes('restak')) return `Restake $${capital} of the staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('liquid staking') || c.includes('staking')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the liquid staking receipt.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name}, open one small hedged position, and close it after a day.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one position in its longest-running market.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk curator')) return `Deposit $${capital} into a ${name} vault on ${chain}, note which curator runs it, and keep the shares.`;
  if (c.includes('stable') || c.includes('dual-token')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the app's savings position.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the hold period.`;
  if (c.includes('launchpad')) return `Stake or hold $${capital} through ${name}'s launchpad on ${chain} and join one allocation round.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${name}'s shielded pool on ${chain} and withdraw it after the hold period.`;
  if (c.includes('ai')) return `Deposit $${capital} into ${name}'s agent or compute pool on ${chain} and run one paid task through it.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} across two separate transactions.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index token on ${chain} and hold it.`;
  if (c.includes('nft')) return `List or buy one item worth about $${capital} through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('chain')) return `Bridge $${capital} onto the chain ${name} runs and use one of its native apps.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, plus the
 * plan's totals. Gas is estimated from the main chain alone: Ethereum mainnet costs an
 * order of magnitude more than the other chains, and the plan says so.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): { steps: string[]; capital: number; gas: number; minutes: number; hold: number } {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const mainnet = isMainnet(chain);
  const setupGas = mainnet ? 12 : 3;
  const weeklyGas = mainnet ? 6 : 1;
  const gas = setupGas + weeklyGas * 4;
  const minutes = 5 + 15 + 10 * 4 + 10 + 5;
  const steps = [
    stepText('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Find the protocol only from the link DefiLlama lists for it.', 'under $3 of gas for the first transaction', '5 minutes'),
    stepText(actionFor(p, capital, chain), `$${capital} of capital and about $${setupGas} of gas on ${chain}`, '15 minutes to set up'),
    stepText('Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and keep the actions in different weeks.', `about $${weeklyGas} of gas a week`, '10 minutes a week'),
    stepText(`Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and do not move the funds between wallets mid-hold.`, `the $${capital} stays in the position`, `${hold} days`),
    stepText("Before you withdraw, open the protocol's own points or rewards page from the link it publishes and claim only there; never pay a fee to claim and never sign a blind approval.", 'no fee to check, and never pay to claim', '10 minutes'),
    stepText('Write the wallet, the dates and every transaction hash in a farm log, then unwind in reverse: withdraw, revoke approvals you no longer need, and keep the log.', 'nothing but the log', '5 minutes'),
  ];
  return { steps, capital, gas, minutes, hold };
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = PARAMS): { board: BoardRow[]; fit: { global: number; byCategory: Map<string, { multiple: number; comps: number }> }; backtest: Backtest } {
  const fit = fitMultiples(snapshot, params);
  const test = backtestFit(snapshot, params);
  const watchlist = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any size.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { multiple, comps } = multipleFor(p, fit);
    const { growthPct, growthMult, maturityMult, age } = multipliers(p, snapshot.as_of, params);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult));
    const plan = farmPlan(p, age);
    return { p, multiple, comps, growthPct, growthMult, maturityMult, age, implied, plan };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_low_usd: Math.max(1, Math.round(s.implied * test.low_factor)),
    implied_high_usd: Math.round(s.implied * test.high_factor),
    model: {
      multiple: s.multiple,
      comps_n: s.comps,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm: {
      capital_usd: s.plan.capital,
      gas_usd: s.plan.gas,
      active_minutes: s.plan.minutes,
      hold_days: s.plan.hold,
    },
    farm_steps: s.plan.steps,
  }));
  return { board, fit, backtest: test };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** How every protocol in the snapshot is accounted for: board, live, or excluded with a reason. */
export function coverageOf(snapshot: Snapshot, board: BoardRow[]): Coverage {
  const onBoard = new Set(board.map((r) => r.slug));
  const reasons = new Map<string, number>();
  let live = 0;
  for (const p of snapshot.protocols) {
    if (onBoard.has(p.slug)) continue;
    if (!isPreToken(p)) {
      live++;
      continue;
    }
    const reason = exclusionReason(p) ?? 'not rankable';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const watchlist = new Set(snapshot.watchlist);
  return {
    total: snapshot.protocols.length,
    watchlist: snapshot.watchlist.length,
    board: board.length,
    early: board.filter((r) => !watchlist.has(r.slug)).length,
    live_token: live,
    excluded: [...reasons.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([reason, count]) => ({ reason, count })),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = PARAMS): { board: BoardRow[]; radar: RadarData } {
  const { board, fit, backtest } = buildBoard(snapshot, params);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    params,
    model_version: MODEL_VERSION,
    global_multiple: fit.global,
    categories: [...fit.byCategory.entries()].map(([category, v]) => ({ category, multiple: v.multiple, comps: v.comps })),
    backtest,
    coverage: coverageOf(snapshot, board),
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
