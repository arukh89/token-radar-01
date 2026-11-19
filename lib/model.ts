// The pre-token radar's model, version 2: one sealed DefiLlama snapshot in, one ranked
// board out.
//
// The board ranks every protocol that records no token and is not a wrapped, staked or
// bridged product of a token that already trades, by an implied launch value fitted from
// the snapshot's own traded protocols. Nothing is hand-picked and no name is special-cased.
//
// The value model is a size curve, and only a size curve:
//
//   log(market cap) = a + b x log(TVL), fitted by least squares on the traded
//   comparables, the slope clamped to [0, 1]; implied = round(exp(a + b x log(TVL)))
//
// Category multiples, a growth term and an age term were all fitted and tested, and all
// three were DROPPED from the value: each one lost to the bare size curve on at least
// one blind test (leave-one-out, and a walk-forward split that fits on protocols listed
// earlier and tests on protocols listed later). The dashboard shows every variant's
// blind-test numbers, so the choice is auditable instead of asserted. Because the curve
// rises with TVL, the board orders by size; what the curve adds over raw TVL is the
// fitted level, the measured error band, and the bootstrap band from refitting.
//
// Growth and age do enter the radar, through a second model that the blind tests
// support: launch odds. A logistic regression on log TVL, 7d growth, age and the six
// most common categories (one-hot, chosen from the snapshot, never hand-picked),
// fitted on every non-product protocol in the snapshot, estimates the base rate at
// which protocols of a given size, growth, age and category record a token. Five-fold
// cross-validation
// beats the base rate, so the odds are shown per row, drive one verdict rule, and scale
// the break-even to an expectation-positive bar. The odds are a descriptive base rate,
// not a forecast that a token launches, and the dashboard says so wherever they appear.
// The value stays the curve's conditional value: what a token would be worth IF one
// launches. The same blind tests set each row's implied range (the leave-one-out error
// quartiles, plus a wider 80% band from the error deciles) and measure each range's
// calibration (how often a held-out market cap lands inside its band). A seeded
// bootstrap (200 refits) gives a third, refit-based band per row. Farm plans are
// derived from each protocol's own record (category, chains, TVL, age, growth): dated
// steps with a cost and a time, a mechanism step that states what activity counts,
// a break-even in dollars, a verdict from stated numeric rules, and a numeric exit
// rule. Each plan also states its net at a $1,000 ticket and a 10% farmers' pool:
// the expected allocation (launch odds x pool share x implied value x ticket / TVL)
// minus gas, time at $15/hour and 4% a year forgone on the ticket; a row is FARM
// only when that net is positive, so a farm plan that loses money in expectation is
// never a FARM.

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

/** The model's tunable constants, stated in the dashboard. */
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
  slope_floor: number;
  slope_cap: number;
  time_value_usd_per_hour: number;
  bootstrap_refits: number;
  bootstrap_seed: number;
  verdict_growth_skip: number;
  verdict_growth_thin: number;
  verdict_odds_thin: number;
  odds_floor: number;
  odds_l2: number;
  odds_iters: number;
  odds_lr: number;
  odds_seed: number;
  odds_growth_floor: number;
  odds_growth_cap: number;
  odds_top_categories: number;
  exit_tvl_fraction: number;
  exit_growth_pct: number;
  net_ticket_usd: number;
  net_pool_share: number;
  net_tbill_rate: number;
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
  slope_floor: 0,
  slope_cap: 1,
  time_value_usd_per_hour: 15,
  bootstrap_refits: 200,
  bootstrap_seed: 20261114,
  verdict_growth_skip: -30,
  verdict_growth_thin: -10,
  verdict_odds_thin: 0.25,
  odds_floor: 0.01,
  odds_l2: 1,
  odds_iters: 1500,
  odds_lr: 0.2,
  odds_seed: 20261114,
  odds_growth_floor: -90,
  odds_growth_cap: 300,
  odds_top_categories: 6,
  exit_tvl_fraction: 0.7,
  exit_growth_pct: -20,
  net_ticket_usd: 1000,
  net_pool_share: 0.1,
  net_tbill_rate: 0.04,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-fit-5';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The fitted size curve: log(mcap) = a + b x log(TVL). */
export interface Curve {
  intercept: number;
  slope: number;
  comps: number;
  tvl_min_usd: number;
  tvl_max_usd: number;
}

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
    boot_low_usd: number;
    boot_high_usd: number;
    range80_low_usd: number;
    range80_high_usd: number;
    launch_odds: number;
    extrapolated: boolean;
  };
  farm: {
    capital_usd: number;
    gas_usd: number;
    active_minutes: number;
    hold_days: number;
    time_value_usd: number;
    total_cost_usd: number;
    breakeven_usd: number;
    breakeven_ev_usd: number;
    breakeven_pct_of_low: number;
    net_ev_usd: number;
    net_forgone_usd: number;
    net_usd: number;
    breakeven_ticket_usd: number | null;
    verdict: 'FARM' | 'THIN' | 'SKIP';
    verdict_reason: string;
    exit_tvl_usd: number;
    start_date: string;
    hold_until_date: string;
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

/** One category's yardstick: diagnostic only, the curve does not use it. */
export interface CategoryDiagnostic {
  category: string;
  median_ratio: number;
  comps: number;
}

/** One blind test's score: how predictions compare with real market caps. */
export interface TestStats {
  n: number;
  median_abs_log_error: number;
  median_ratio: number;
  within_2x: number;
}

/** One model variant's blind-test record: kept only when both tests keep it. */
export interface VariantTest {
  name: string;
  label: string;
  kept: boolean;
  loo: TestStats;
  walk_forward: TestStats | null;
}

/** The leave-one-out backtest of the kept fit, plus its range factors. */
export interface Backtest {
  comps: number;
  median_abs_log_error: number;
  median_ratio: number;
  within_2x: number;
  low_factor: number;
  high_factor: number;
  low80_factor: number;
  high80_factor: number;
  coverage80: number;
}

/** The launch-odds model: a descriptive base rate, cross-validated, never a forecast. */
export interface LaunchOdds {
  n: number;
  token_n: number;
  pretoken_n: number;
  base_rate: number;
  auc: number;
  logloss: number;
  base_logloss: number;
  intercept: number;
  coef_log_tvl: number;
  coef_growth: number;
  coef_age_years: number;
  categories: string[];
  coef_category: number[];
  median_growth: number;
  median_age_days: number;
  calibration: { decile: number; mean_pred: number; token_rate: number; n: number }[];
  quartile_rates: { by: string; rates: number[]; ns: number[] }[];
}

/** The validation record: every variant tested, the calibration, the bootstrap, the odds. */
export interface Validation {
  kept: string;
  split_date: string | null;
  train_n: number;
  test_n: number;
  variants: VariantTest[];
  calibration: { low_factor: number; high_factor: number; coverage: number; n: number; low80_factor: number; high80_factor: number; coverage80: number };
  launch_odds: LaunchOdds;
  bootstrap: {
    refits: number;
    slope_p5: number;
    slope_median: number;
    slope_p95: number;
    intercept_p5: number;
    intercept_median: number;
    intercept_p95: number;
  };
}

/** How every protocol in the snapshot is accounted for. */
export interface Coverage {
  total: number;
  watchlist: number;
  board: number;
  early: number;
  live_token: number;
  excluded: { reason: string; count: number }[];
  excluded_named: { slug: string; name: string; reason: string }[];
}

/** Everything the dashboard needs: the board, the live set, the fit and the accounting. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  params: ModelParams;
  model_version: string;
  curve: Curve;
  global_multiple: number;
  categories: CategoryDiagnostic[];
  backtest: Backtest;
  validation: Validation;
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

/** A date `days` after an ISO date, as an ISO date; the input unchanged when unparseable. */
export function addDays(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(t)) return isoDate;
  return new Date(t + days * DAY_MS).toISOString().slice(0, 10);
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

/** A deterministic stream of [0, 1) values from a seed: the bootstrap refits are reproducible. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
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

/** The traded comparables the curve is fitted from. */
export function comparables(snapshot: Snapshot, params: ModelParams): Comp[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX' && !VERSIONED.test(p.name))
    .map((p) => ({ category: p.category ?? 'Other', ratio: winsorised(p.mcap_usd! / p.tvl_usd, params), protocol: p }));
}

/**
 * The size curve fitted on a list of comparables: least squares of log(market cap) on
 * log(TVL), the slope clamped to [slope_floor, slope_cap] so a strange snapshot can
 * never invert the curve or explode it. With fewer than 2 comparables, or no spread
 * in TVL, the curve is flat at the geometric mean market cap.
 */
export function fitCurve(list: Comp[], params: ModelParams): Curve {
  const tvls = list.map((c) => c.protocol.tvl_usd);
  const tvlMin = tvls.length > 0 ? Math.min(...tvls) : 0;
  const tvlMax = tvls.length > 0 ? Math.max(...tvls) : 0;
  if (list.length < 2) {
    const mean = list.length === 1 ? Math.log(list[0]!.protocol.mcap_usd!) : 0;
    return { intercept: mean, slope: 0, comps: list.length, tvl_min_usd: tvlMin, tvl_max_usd: tvlMax };
  }
  const xs = list.map((c) => Math.log(c.protocol.tvl_usd));
  const ys = list.map((c) => Math.log(c.protocol.mcap_usd!));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  const rawSlope = den === 0 ? 0 : num / den;
  const slope = Math.min(params.slope_cap, Math.max(params.slope_floor, rawSlope));
  return { intercept: my - slope * mx, slope, comps: list.length, tvl_min_usd: tvlMin, tvl_max_usd: tvlMax };
}

/** The curve's prediction for a TVL: exp(a + b x log(TVL)), clamped to the gate's band. */
export function curveValue(tvl: number, curve: Curve): number {
  if (!(tvl > 0) || !Number.isFinite(tvl)) return 1;
  return Math.min(100_000_000_000_000, Math.max(1, Math.exp(curve.intercept + curve.slope * Math.log(tvl))));
}

/** The effective multiple at a TVL: the curve's value divided by the TVL itself. */
export function curveMultiple(tvl: number, curve: Curve): number {
  return tvl > 0 ? curveValue(tvl, curve) / tvl : 0;
}

/** The growth and maturity multipliers one protocol gets under `params` (ablation variants only). */
export function multipliers(p: SnapshotProtocol, asOf: string, params: ModelParams): { growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(params.growth_cap, Math.max(params.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * params.growth_weight;
  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult = params.maturity_floor + (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days) * params.maturity_range;
  return { growthPct, growthMult, maturityMult, age };
}

/** A fitted variant: how it is fitted from comparables, and how it predicts one protocol. */
interface Variant {
  name: string;
  label: string;
  fit: (list: Comp[]) => unknown;
  predict: (p: SnapshotProtocol, fitted: unknown) => number;
}

/** The six variants the blind tests judge. Only the bare curve is kept (see validateVariants). */
function variants(snapshot: Snapshot, params: ModelParams): Variant[] {
  const flat = {
    name: 'flat',
    label: 'Flat multiple (median mcap/TVL, no curve)',
    fit: (list: Comp[]) => median(list.map((c) => c.ratio)),
    predict: (p: SnapshotProtocol, fitted: unknown) => Math.max(1, Math.round(p.tvl_usd * (fitted as number))),
  };
  const curveOnly: Variant = {
    name: 'curve',
    label: 'Size curve (kept model)',
    fit: (list: Comp[]) => fitCurve(list, params),
    predict: (p: SnapshotProtocol, fitted: unknown) => Math.max(1, Math.round(curveValue(p.tvl_usd, fitted as Curve))),
  };
  const withGrowth: Variant = {
    name: 'curve+growth',
    label: 'Size curve x 7d growth',
    fit: (list: Comp[]) => fitCurve(list, params),
    predict: (p: SnapshotProtocol, fitted: unknown) => {
      const { growthMult } = multipliers(p, snapshot.as_of, params);
      return Math.max(1, Math.round(curveValue(p.tvl_usd, fitted as Curve) * growthMult));
    },
  };
  const withMaturity: Variant = {
    name: 'curve+maturity',
    label: 'Size curve x age with no token',
    fit: (list: Comp[]) => fitCurve(list, params),
    predict: (p: SnapshotProtocol, fitted: unknown) => {
      const { maturityMult } = multipliers(p, snapshot.as_of, params);
      return Math.max(1, Math.round(curveValue(p.tvl_usd, fitted as Curve) * maturityMult));
    },
  };
  const withBoth: Variant = {
    name: 'curve+growth+maturity',
    label: 'Size curve x growth x age',
    fit: (list: Comp[]) => fitCurve(list, params),
    predict: (p: SnapshotProtocol, fitted: unknown) => {
      const { growthMult, maturityMult } = multipliers(p, snapshot.as_of, params);
      return Math.max(1, Math.round(curveValue(p.tvl_usd, fitted as Curve) * growthMult * maturityMult));
    },
  };
  const withCategory: Variant = {
    name: 'curve+category',
    label: 'Size curve + category intercepts',
    fit: (list: Comp[]) => {
      const base = fitCurve(list, params);
      const groups = new Map<string, number[]>();
      for (const c of list) {
        const r = Math.log(c.protocol.mcap_usd!) - base.slope * Math.log(c.protocol.tvl_usd);
        const arr = groups.get(c.category) ?? [];
        arr.push(r);
        groups.set(c.category, arr);
      }
      const residuals = list.map((c) => Math.log(c.protocol.mcap_usd!) - base.slope * Math.log(c.protocol.tvl_usd));
      const globalA = median(residuals);
      const aByCat = new Map<string, number>();
      for (const [cat, rs] of groups) {
        const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
        aByCat.set(cat, rs.length >= params.min_category_comps ? (rs.length * mean + params.shrink_prior * globalA) / (rs.length + params.shrink_prior) : globalA);
      }
      return { base, globalA, aByCat };
    },
    predict: (p: SnapshotProtocol, fitted: unknown) => {
      const f = fitted as { base: Curve; globalA: number; aByCat: Map<string, number> };
      const a = p.category !== null && f.aByCat.has(p.category) ? f.aByCat.get(p.category)! : f.globalA;
      return Math.max(1, Math.round(Math.exp(a + f.base.slope * Math.log(Math.max(1, p.tvl_usd)))));
    },
  };
  return [flat, curveOnly, withGrowth, withMaturity, withBoth, withCategory];
}

/** One test's score from (predicted, actual) pairs. */
function scorePairs(pairs: [number, number][]): TestStats {
  const ratios = pairs.map(([pred, actual]) => pred / actual);
  const logErrors = ratios.map((r) => Math.abs(Math.log(r)));
  return {
    n: pairs.length,
    median_abs_log_error: round4(median(logErrors)),
    median_ratio: round4(median(ratios)),
    within_2x: round4(ratios.filter((r) => r >= 0.5 && r <= 2).length / Math.max(1, ratios.length)),
  };
}

/**
 * The blind tests: leave-one-out (each comparable predicted from a fit that never saw
 * it) and walk-forward (fit on the comparables listed before the median listing date,
 * tested on those listed at or after it). A variant is kept only when it is no worse
 * than the bare curve on BOTH tests' median absolute log error; the bare curve is
 * always kept, and ties keep the simpler variant, so the kept model is the curve.
 */
export function validateVariants(snapshot: Snapshot, params: ModelParams): { variants: VariantTest[]; splitDate: string | null; trainN: number; testN: number } {
  const comps = comparables(snapshot, params);
  const dated = comps.filter((c) => c.protocol.listed_at !== null).sort((a, b) => (a.protocol.listed_at! < b.protocol.listed_at! ? -1 : a.protocol.listed_at! > b.protocol.listed_at! ? 1 : a.protocol.slug < b.protocol.slug ? -1 : 1));
  const splitDate = dated.length >= 20 ? dated[Math.floor(dated.length / 2)]!.protocol.listed_at : null;
  const train = splitDate === null ? [] : dated.filter((c) => c.protocol.listed_at! < splitDate);
  const test = splitDate === null ? [] : dated.filter((c) => c.protocol.listed_at! >= splitDate);
  const tested: VariantTest[] = variants(snapshot, params).map((v) => {
    const looPairs: [number, number][] = [];
    for (let i = 0; i < comps.length; i++) {
      const held = comps[i]!;
      const fitted = v.fit(comps.filter((_, j) => j !== i));
      looPairs.push([v.predict(held.protocol, fitted), held.protocol.mcap_usd!]);
    }
    const wf = train.length >= 10 && test.length >= 10 ? scorePairs(test.map((c) => [v.predict(c.protocol, v.fit(train)), c.protocol.mcap_usd!])) : null;
    return { name: v.name, label: v.label, kept: false, loo: scorePairs(looPairs), walk_forward: wf };
  });
  const curve = tested.find((t) => t.name === 'curve')!;
  for (const t of tested) {
    t.kept = t.name === 'curve' || (t.loo.median_abs_log_error < curve.loo.median_abs_log_error && (t.walk_forward === null || curve.walk_forward === null || t.walk_forward.median_abs_log_error < curve.walk_forward.median_abs_log_error));
  }
  return { variants: tested, splitDate, trainN: train.length, testN: test.length };
}

/**
 * The kept curve's leave-one-out predictions: the backtest, the range factors (the
 * error quartiles, clamped to [0.25x, 4x]), a wider 80% band (the error deciles,
 * clamped to [0.1x, 10x]) and the calibration of each band (how often a held-out
 * market cap lands inside its own band).
 */
export function backtestCurve(snapshot: Snapshot, params: ModelParams): { backtest: Backtest; calibration: { low_factor: number; high_factor: number; coverage: number; n: number; low80_factor: number; high80_factor: number; coverage80: number } } {
  const comps = comparables(snapshot, params);
  const pairs: [number, number][] = [];
  for (let i = 0; i < comps.length; i++) {
    const held = comps[i]!;
    const fitted = fitCurve(comps.filter((_, j) => j !== i), params);
    pairs.push([Math.max(1, Math.round(curveValue(held.protocol.tvl_usd, fitted))), held.protocol.mcap_usd!]);
  }
  const stats = scorePairs(pairs);
  const ratios = pairs.map(([pred, actual]) => pred / actual).sort((a, b) => a - b);
  const q = (f: number): number => ratios[Math.min(ratios.length - 1, Math.floor(f * ratios.length))]!;
  const low = round4(Math.min(1, Math.max(0.25, q(0.25))));
  const high = round4(Math.max(1, Math.min(4, q(0.75))));
  const low80 = round4(Math.min(1, Math.max(0.1, q(0.1))));
  const high80 = round4(Math.max(1, Math.min(10, q(0.9))));
  const covered = pairs.filter(([pred, actual]) => actual >= pred * low && actual <= pred * high).length;
  const covered80 = pairs.filter(([pred, actual]) => actual >= pred * low80 && actual <= pred * high80).length;
  return {
    backtest: { comps: comps.length, median_abs_log_error: stats.median_abs_log_error, median_ratio: stats.median_ratio, within_2x: stats.within_2x, low_factor: low, high_factor: high, low80_factor: low80, high80_factor: high80, coverage80: round4(covered80 / Math.max(1, pairs.length)) },
    calibration: { low_factor: low, high_factor: high, coverage: round4(covered / Math.max(1, pairs.length)), n: pairs.length, low80_factor: low80, high80_factor: high80, coverage80: round4(covered80 / Math.max(1, pairs.length)) },
  };
}

/**
 * The bootstrap: refit the curve on resampled comparables (seeded, so the refits are
 * the same every run) and record, per TVL, the 5th/95th percentile of the refitted
 * values, plus the slope and intercept percentiles. A wide band means the curve is
 * unsure at that size; the band is a second, independent uncertainty from the
 * leave-one-out range.
 */
export function bootstrapBands(snapshot: Snapshot, params: ModelParams, tvls: number[]): { bands: Map<number, { low: number; high: number }>; slope: { p5: number; median: number; p95: number }; intercept: { p5: number; median: number; p95: number } } {
  const comps = comparables(snapshot, params);
  const rnd = mulberry32(params.bootstrap_seed);
  const slopes: number[] = [];
  const intercepts: number[] = [];
  const values = new Map<number, number[]>();
  for (const tvl of tvls) values.set(tvl, []);
  for (let k = 0; k < params.bootstrap_refits; k++) {
    const sample: Comp[] = [];
    for (let i = 0; i < comps.length; i++) sample.push(comps[Math.floor(rnd() * comps.length)]!);
    const fitted = fitCurve(sample, params);
    slopes.push(fitted.slope);
    intercepts.push(fitted.intercept);
    for (const tvl of tvls) values.get(tvl)!.push(curveValue(tvl, fitted));
  }
  const pct = (sorted: number[], f: number): number => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))]!;
  const bands = new Map<number, { low: number; high: number }>();
  for (const [tvl, list] of values) {
    const sorted = [...list].sort((a, b) => a - b);
    bands.set(tvl, { low: Math.max(1, Math.round(pct(sorted, 0.05))), high: Math.max(1, Math.round(pct(sorted, 0.95))) });
  }
  const sSorted = [...slopes].sort((a, b) => a - b);
  const iSorted = [...intercepts].sort((a, b) => a - b);
  return {
    bands,
    slope: { p5: round4(pct(sSorted, 0.05)), median: round4(median(slopes)), p95: round4(pct(sSorted, 0.95)) },
    intercept: { p5: round4(pct(iSorted, 0.05)), median: round4(median(intercepts)), p95: round4(pct(iSorted, 0.95)) },
  };
}

// ---------------------------------------------------------------- launch odds

/**
 * Launch odds: the base rate at which protocols of a given size, growth, age and
 * category record a token. A logistic regression on log TVL, 7d growth, age in years
 * and one-hot flags for the six most common categories, fitted on every non-product
 * protocol in the snapshot (token or not), with the features standardised and an L2
 * penalty. Category predicts token STATUS here, not value: the same category terms
 * lost to the bare size curve as value terms, but as odds terms they improve both
 * cross-validated AUC and log-loss. The shortlist is counted from the data, never
 * hand-picked, and in cross-validation it is re-counted on each fold's training rows
 * alone, so no held-out row leaks into its own prediction. Five-fold stratified
 * cross-validation must beat the base rate, or the odds are not shown as evidence.
 * The shuffle is a Fisher-Yates with the seeded generator, so the folds are the same
 * on every engine. The odds are descriptive — "among protocols this old, this big,
 * growing this fast and in this category, this share records a token" — never a
 * forecast that a token launches: the snapshot holds no future outcome, and old
 * protocols that never launched may never launch. The dashboard states that caveat
 * wherever the odds appear.
 */
interface OddsRow {
  p: SnapshotProtocol;
  y: number;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function fitLaunchOdds(snapshot: Snapshot, params: ModelParams): { odds: LaunchOdds; predict: (p: SnapshotProtocol) => number } {
  const rows: OddsRow[] = snapshot.protocols
    .filter((p) => exclusionReason(p) === null && p.tvl_usd > 0)
    .map((p) => ({ p, y: isPreToken(p) ? 0 : 1 }));
  const medChange = median(rows.map((d) => d.p.change_7d).filter((v): v is number => v !== null));
  const medAge = median(rows.map((d) => ageDays(snapshot.as_of, d.p.listed_at)).filter((v): v is number => v !== null));
  const baseFeats = (p: SnapshotProtocol): [number, number, number] => [
    Math.log(p.tvl_usd),
    clampNum(p.change_7d ?? medChange, params.odds_growth_floor, params.odds_growth_cap),
    (ageDays(snapshot.as_of, p.listed_at) ?? medAge) / 365,
  ];
  // The category shortlist: the most common categories among the given rows, counted
  // from the data. Ties keep first-seen order (the sort is stable), so the shortlist
  // is deterministic for a given snapshot and row order.
  const topCategories = (list: OddsRow[]): string[] => {
    const counts = new Map<string, number>();
    for (const d of list) {
      const key = d.p.category ?? 'Other';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, params.odds_top_categories).map(([key]) => key);
  };
  const feats = (cats: string[]) => (p: SnapshotProtocol): number[] => [
    ...baseFeats(p),
    ...cats.map((c) => ((p.category ?? 'Other') === c ? 1 : 0)),
  ];
  const fit = (list: OddsRow[], cats: string[]): { w: number[]; mu: number[]; sd: number[] } => {
    const f = feats(cats);
    const X = list.map((d) => f(d.p));
    const k = X[0]!.length;
    const mu: number[] = [];
    const sd: number[] = [];
    for (let j = 0; j < k; j++) {
      const vs = X.map((r) => r[j]!);
      const m = vs.reduce((a, b) => a + b, 0) / vs.length;
      mu.push(m);
      sd.push(Math.sqrt(vs.reduce((a, b) => a + (b - m) ** 2, 0) / vs.length) || 1);
    }
    const Z = X.map((r) => r.map((v, j) => (v - mu[j]!) / sd[j]!));
    const w = new Array(k + 1).fill(0);
    for (let it = 0; it < params.odds_iters; it++) {
      const grad = new Array(k + 1).fill(0);
      for (let i = 0; i < Z.length; i++) {
        let z = w[0]!;
        for (let j = 0; j < k; j++) z += Z[i]![j]! * w[j + 1]!;
        const pr = 1 / (1 + Math.exp(-z));
        const e = pr - list[i]!.y;
        grad[0] += e;
        for (let j = 0; j < k; j++) grad[j + 1] += e * Z[i]![j]!;
      }
      for (let j = 0; j <= k; j++) w[j] = w[j]! - (params.odds_lr / Z.length) * grad[j]! - (j > 0 ? (params.odds_lr * params.odds_l2 / Z.length) * w[j]! : 0);
    }
    return { w, mu, sd };
  };
  const predictWith = (m: { w: number[]; mu: number[]; sd: number[] }, cats: string[], p: SnapshotProtocol): number => {
    const f = feats(cats)(p);
    const z = m.w[0]! + f.reduce((a, v, j) => a + ((v - m.mu[j]!) / m.sd[j]!) * m.w[j + 1]!, 0);
    return 1 / (1 + Math.exp(-z));
  };
  // Stratified folds over a seeded Fisher-Yates shuffle.
  const rnd = mulberry32(params.odds_seed);
  const shuffled = [...rows];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const folds: OddsRow[][] = [[], [], [], [], []];
  const byY: OddsRow[][] = [[], []];
  for (const d of shuffled) byY[d.y]!.push(d);
  for (const g of byY) g.forEach((d, i) => folds[i % 5]!.push(d));
  const oof: { y: number; pr: number }[] = [];
  for (let f = 0; f < 5; f++) {
    const train = folds.flatMap((g, i) => (i === f ? [] : g));
    const cats = topCategories(train);
    const m = fit(train, cats);
    for (const d of folds[f]!) oof.push({ y: d.y, pr: predictWith(m, cats, d.p) });
  }
  const pos = oof.filter((d) => d.y === 1);
  const neg = oof.filter((d) => d.y === 0);
  let concordant = 0;
  for (const a of pos) for (const b of neg) concordant += a.pr > b.pr ? 1 : a.pr === b.pr ? 0.5 : 0;
  const auc = round4(concordant / Math.max(1, pos.length * neg.length));
  const logloss = round4(-oof.reduce((a, d) => a + (d.y === 1 ? Math.log(Math.max(1e-9, d.pr)) : Math.log(Math.max(1e-9, 1 - d.pr))), 0) / Math.max(1, oof.length));
  const tokenN = rows.filter((d) => d.y === 1).length;
  const baseRate = rows.length === 0 ? 0 : tokenN / rows.length;
  const baseLogloss = round4(-(baseRate * Math.log(Math.max(1e-9, baseRate)) + (1 - baseRate) * Math.log(Math.max(1e-9, 1 - baseRate))));
  const fullCats = topCategories(rows);
  const full = fit(rows, fullCats);
  const predict = (p: SnapshotProtocol): number => predictWith(full, fullCats, p);
  // Calibration deciles: predicted odds against the actual token rate, same universe.
  const scored = rows.map((d) => ({ y: d.y, pr: predict(d.p) })).sort((a, b) => a.pr - b.pr);
  const calibration: LaunchOdds['calibration'] = [];
  for (let i = 0; i < 10; i++) {
    const group = scored.slice(Math.floor((i * scored.length) / 10), Math.floor(((i + 1) * scored.length) / 10));
    if (group.length === 0) continue;
    calibration.push({
      decile: i + 1,
      mean_pred: round4(group.reduce((a, d) => a + d.pr, 0) / group.length),
      token_rate: round4(group.reduce((a, d) => a + d.y, 0) / group.length),
      n: group.length,
    });
  }
  // Univariate quartile rates: what each feature alone says about recording a token.
  const quartileRates = (key: (p: SnapshotProtocol) => number | null): { rates: number[]; ns: number[] } => {
    const listed = rows.map((d) => ({ v: key(d.p), y: d.y })).filter((r): r is { v: number; y: number } => r.v !== null).sort((a, b) => a.v - b.v);
    const rates: number[] = [];
    const ns: number[] = [];
    for (let i = 0; i < 4; i++) {
      const group = listed.slice(Math.floor((i * listed.length) / 4), Math.floor(((i + 1) * listed.length) / 4));
      rates.push(round4(group.reduce((a, r) => a + r.y, 0) / Math.max(1, group.length)));
      ns.push(group.length);
    }
    return { rates, ns };
  };
  const qTvl = quartileRates((p) => Math.log(p.tvl_usd));
  const qAge = quartileRates((p) => ageDays(snapshot.as_of, p.listed_at));
  const qGrowth = quartileRates((p) => p.change_7d);
  return {
    odds: {
      n: rows.length,
      token_n: tokenN,
      pretoken_n: rows.length - tokenN,
      base_rate: round4(baseRate),
      auc,
      logloss,
      base_logloss: baseLogloss,
      intercept: round4(full.w[0]!),
      coef_log_tvl: round4(full.w[1]!),
      coef_growth: round4(full.w[2]!),
      coef_age_years: round4(full.w[3]!),
      categories: fullCats,
      coef_category: full.w.slice(4).map((w) => round4(w)),
      median_growth: round4(medChange),
      median_age_days: medAge,
      calibration,
      quartile_rates: [
        { by: 'TVL', rates: qTvl.rates, ns: qTvl.ns },
        { by: 'age', rates: qAge.rates, ns: qAge.ns },
        { by: 'growth', rates: qGrowth.rates, ns: qGrowth.ns },
      ],
    },
    predict,
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

/** How much capital one farm position needs: the uniform ticket the net model prices. */
function capitalFor(params: ModelParams): number {
  return params.net_ticket_usd;
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

/** What activity counts toward qualification, from the category's mechanism alone. */
function countsFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'supplied assets and repaid borrows, held across weekly snapshots rather than flash deposits';
  if (c.includes('dex') || c.includes('leveraged farm')) return 'liquidity held in the pool across time, not one deposit and withdrawal';
  if (c.includes('yield aggregator') || c.includes('yield')) return 'vault shares held continuously; moving between vaults resets the clock';
  if (c.includes('bridge')) return 'bridged volume that stays on the destination chain';
  if (c.includes('liquid restak') || c.includes('restak')) return 'restaked assets held through the receipt token';
  if (c.includes('liquid staking') || c.includes('staking')) return 'staked assets held through the receipt token';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'trading volume and margin held open, not a single closed trade';
  if (c.includes('prediction')) return 'positions held in live markets until they resolve';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk curator')) return 'deposits held in the vault across rebalances';
  if (c.includes('stable') || c.includes('dual-token')) return 'stable assets minted or held in the savings position';
  if (c.includes('rwa')) return 'the yield-bearing asset held in the wallet across snapshots';
  if (c.includes('insurance')) return 'cover kept active for the whole hold period';
  if (c.includes('launchpad')) return 'staked or held balances at allocation snapshots';
  if (c.includes('privacy')) return 'funds held in the shielded pool, not passed straight through';
  if (c.includes('ai')) return 'paid tasks run through the pool, not idle deposits';
  if (c.includes('payment')) return 'payment volume routed across separate transactions';
  if (c.includes('index')) return 'index tokens held across rebalances';
  if (c.includes('nft')) return 'listed or held items with the receipt kept';
  if (c.includes('chain')) return 'activity in the chain\u2019s native apps after bridging';
  return 'a position held open across the hold period, not a same-day round trip';
}

/**
 * A protocol's farm verdict, from stated numeric rules applied to every row alike:
 * SKIP when the TVL lies outside the comparables' fitted range (the curve
 * extrapolates there) or when 7d growth is at or below verdict_growth_skip; THIN
 * when growth is below verdict_growth_thin, when the launch odds are below
 * verdict_odds_thin, or when the plan's net at the default ticket and pool share
 * is not positive; otherwise FARM. The net is the expected allocation (launch
 * odds x pool share x implied value x ticket / TVL) minus gas, time and the T-bill
 * rate forgone on the ticket. The bootstrap band is shown for every row but does
 * not drive the verdict: it is narrower than the model's leave-one-out error range
 * at every size, so it never dominates the uncertainty. The verdict is about the
 * trend, the fit's range, the base rate and whether the plan pays, never a promise
 * of a token.
 */
export function verdictFor(
  extrapolated: boolean,
  growth: number | null,
  odds: number,
  net: { ev: number; net: number; gas: number; timeValue: number; totalCost: number },
  params: ModelParams,
): { verdict: 'FARM' | 'THIN' | 'SKIP'; reason: string } {
  const g = growth ?? 0;
  const ticket = `$${params.net_ticket_usd.toLocaleString('en-US')}`;
  const share = `${Math.round(params.net_pool_share * 100)}%`;
  const netStr = `Net ${net.net > 0 ? '+' : '-'}$${Math.abs(net.net).toFixed(2)} at a ${ticket} ticket and ${share} pool`;
  if (extrapolated) return { verdict: 'SKIP', reason: 'TVL outside the fitted range: the curve extrapolates here' };
  if (g <= params.verdict_growth_skip) return { verdict: 'SKIP', reason: `7d growth ${g.toFixed(1)}%: shrinking fast` };
  if (g < params.verdict_growth_thin) {
    const base = `7d growth ${g.toFixed(1)}%: shrinking, size the position small`;
    return { verdict: 'THIN', reason: net.net > 0 ? `${base}. ${netStr}.` : base };
  }
  if (odds < params.verdict_odds_thin) {
    const base = `launch odds ${(odds * 100).toFixed(0)}%: below the ${(params.verdict_odds_thin * 100).toFixed(0)}% thin line`;
    return { verdict: 'THIN', reason: net.net > 0 ? `${base}. ${netStr}.` : base };
  }
  if (net.net > 0) return { verdict: 'FARM', reason: `${netStr}: expected allocation $${net.ev.toFixed(2)} covers $${net.totalCost} cost` };
  if (net.net > -net.timeValue) return { verdict: 'THIN', reason: `${netStr}: expected allocation $${net.ev.toFixed(2)} covers gas but not the $${net.timeValue} of time` };
  return { verdict: 'THIN', reason: `${netStr}: expected allocation $${net.ev.toFixed(2)} does not cover $${net.totalCost} cost` };
}

/**
 * A protocol's farm plan: seven dated steps, each an action with a cost and a time,
 * plus the plan's economics. Gas is estimated from the main chain alone: Ethereum
 * mainnet costs an order of magnitude more than the other chains, and the plan says
 * so. Active time is valued at the stated hourly rate, so the break-even is the full
 * cost of farming, not gas alone; the break-even is what an allocation to this
 * farmer must exceed for the plan to net positive, before any token exists. The
 * expectation break-even scales that cost by the launch odds: the allocation, if a
 * token launches, that makes the plan positive in expectation. The net at the
 * default ticket and pool share, and the ticket at which the plan starts to pay
 * (null when no ticket pays), are computed beside it: the expected allocation is
 * the launch odds times the pool share of the implied value times this ticket's
 * share of TVL, minus gas, time and the T-bill rate forgone while the ticket is
 * locked.
 */
export function farmPlan(
  p: SnapshotProtocol,
  asOf: string,
  age: number | null,
  implied: number,
  impliedLow: number,
  extrapolated: boolean,
  odds: number,
  params: ModelParams,
): { steps: string[]; capital: number; gas: number; minutes: number; hold: number; timeValue: number; totalCost: number; breakeven: number; breakevenEv: number; breakevenPct: number; netEv: number; netForgone: number; net: number; breakevenTicket: number | null; verdict: 'FARM' | 'THIN' | 'SKIP'; reason: string; exitTvl: number; start: string; holdUntil: string } {
  const chain = chainOf(p);
  const capital = capitalFor(params);
  const hold = holdDaysFor(age);
  const mainnet = isMainnet(chain);
  const setupGas = mainnet ? 12 : 3;
  const weeklyGas = mainnet ? 6 : 1;
  const gas = setupGas + weeklyGas * 4;
  const minutes = 5 + 15 + 10 * 4 + 10 + 5;
  const timeValue = Math.round((minutes / 60) * params.time_value_usd_per_hour);
  const totalCost = gas + timeValue;
  const breakeven = totalCost;
  const breakevenEv = Math.round(totalCost / Math.max(odds, params.odds_floor));
  const breakevenPct = round4((totalCost / Math.max(1, impliedLow)) * 100);
  const ticket = params.net_ticket_usd;
  const share = params.net_pool_share;
  const netEv = odds * share * implied * (ticket / p.tvl_usd);
  const netForgone = ticket * params.net_tbill_rate * hold / 365;
  const net = netEv - gas - timeValue - netForgone;
  const perDollar = odds * share * (implied / p.tvl_usd) - (params.net_tbill_rate * hold) / 365;
  const breakevenTicket = perDollar > 0 ? Math.round((gas + timeValue) / perDollar) : null;
  const { verdict, reason } = verdictFor(extrapolated, p.change_7d, odds, { ev: netEv, net, gas, timeValue, totalCost }, params);
  const exitTvl = Math.max(1, Math.round(p.tvl_usd * params.exit_tvl_fraction));
  const start = asOf;
  const holdUntil = addDays(asOf, hold);
  const firstCheck = addDays(asOf, 7);
  const steps = [
    stepText('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Find the protocol only from the link DefiLlama lists for it.', 'under $3 of gas for the first transaction', '5 minutes'),
    stepText(`Starting ${start}, ${actionFor(p, capital, chain)}`, `$${capital} of capital and about $${setupGas} of gas on ${chain}`, '15 minutes to set up'),
    stepText(`What counts as activity here: ${countsFor(p)}. This is the plan's reading of the protocol's mechanism from its category alone; the snapshot carries no points program, so check it on the protocol's own page.`, 'no extra cost', '5 minutes to confirm'),
    stepText(`Check the position every week from ${firstCheck}: record TVL and 7d change, and exit at once if TVL falls below $${exitTvl.toLocaleString('en-US')} (30% under the snapshot TVL) or 7d change is below -20% on two weekly checks in a row.`, `about $${weeklyGas} of gas a week`, '10 minutes a week'),
    stepText(`Verdict ${verdict}: ${reason}. Hold until ${holdUntil} (${hold} days). The plan nets positive only if your allocation exceeds $${breakeven} (gas $${gas} plus ${minutes} minutes valued at $${params.time_value_usd_per_hour}/hour), which is ${breakevenPct}% of the low-end value.`, `the $${capital} stays in the position`, `${hold} days`),
    stepText("Before you withdraw, open the protocol's own points or rewards page from the link it publishes and claim only there; never pay a fee to claim and never sign a blind approval.", 'no fee to check, and never pay to claim', '10 minutes'),
    stepText(`Write the wallet, the dates and every transaction hash in a farm log, then unwind after ${holdUntil} in reverse: withdraw, revoke approvals you no longer need, and keep the log.`, 'nothing but the log', '5 minutes'),
  ];
  return { steps, capital, gas, minutes, hold, timeValue, totalCost, breakeven, breakevenEv, breakevenPct, netEv, netForgone, net, breakevenTicket, verdict, reason, exitTvl, start, holdUntil };
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = PARAMS): { board: BoardRow[]; curve: Curve; backtest: Backtest; validation: Validation } {
  const comps = comparables(snapshot, params);
  if (comps.length < 10) throw new SnapshotError(`only ${comps.length} traded comparables: too few to fit the size curve`);
  const curve = fitCurve(comps, params);
  const { backtest, calibration } = backtestCurve(snapshot, params);
  const { variants: variantTests, splitDate, trainN, testN } = validateVariants(snapshot, params);
  const { odds: launchOdds, predict: predictOdds } = fitLaunchOdds(snapshot, params);
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
  const picked = [...chosen.values()];
  const boot = bootstrapBands(snapshot, params, picked.map((p) => p.tvl_usd));
  const scored = picked.map((p) => {
    const multiple = curveMultiple(p.tvl_usd, curve);
    // The board's number comes from the stored multiple, exactly as the page recomputes it.
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple));
    const age = ageDays(snapshot.as_of, p.listed_at);
    const band = boot.bands.get(p.tvl_usd)!;
    const extrapolated = p.tvl_usd < curve.tvl_min_usd || p.tvl_usd > curve.tvl_max_usd;
    const odds = round4(predictOdds(p));
    const plan = farmPlan(p, snapshot.as_of, age, implied, Math.max(1, Math.round(implied * backtest.low_factor)), extrapolated, odds, params);
    return { p, multiple, age, implied, band, extrapolated, odds, plan };
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
    implied_low_usd: Math.max(1, Math.round(s.implied * backtest.low_factor)),
    implied_high_usd: Math.round(s.implied * backtest.high_factor),
    model: {
      multiple: s.multiple,
      comps_n: comps.length,
      boot_low_usd: s.band.low,
      boot_high_usd: s.band.high,
      range80_low_usd: Math.max(1, Math.round(s.implied * backtest.low80_factor)),
      range80_high_usd: Math.round(s.implied * backtest.high80_factor),
      launch_odds: s.odds,
      extrapolated: s.extrapolated,
    },
    farm: {
      capital_usd: s.plan.capital,
      gas_usd: s.plan.gas,
      active_minutes: s.plan.minutes,
      hold_days: s.plan.hold,
      time_value_usd: s.plan.timeValue,
      total_cost_usd: s.plan.totalCost,
      breakeven_usd: s.plan.breakeven,
      breakeven_ev_usd: s.plan.breakevenEv,
      breakeven_pct_of_low: s.plan.breakevenPct,
      net_ev_usd: s.plan.netEv,
      net_forgone_usd: s.plan.netForgone,
      net_usd: s.plan.net,
      breakeven_ticket_usd: s.plan.breakevenTicket,
      verdict: s.plan.verdict,
      verdict_reason: s.plan.reason,
      exit_tvl_usd: s.plan.exitTvl,
      start_date: s.plan.start,
      hold_until_date: s.plan.holdUntil,
    },
    farm_steps: s.plan.steps,
  }));
  const validation: Validation = {
    kept: 'curve',
    split_date: splitDate,
    train_n: trainN,
    test_n: testN,
    variants: variantTests,
    calibration,
    launch_odds: launchOdds,
    bootstrap: {
      refits: params.bootstrap_refits,
      slope_p5: boot.slope.p5,
      slope_median: boot.slope.median,
      slope_p95: boot.slope.p95,
      intercept_p5: boot.intercept.p5,
      intercept_median: boot.intercept.median,
      intercept_p95: boot.intercept.p95,
    },
  };
  return { board, curve, backtest, validation };
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

/** The per-category median ratios, diagnostic only: the curve does not use categories. */
export function categoryDiagnostics(snapshot: Snapshot, params: ModelParams): CategoryDiagnostic[] {
  const groups = new Map<string, number[]>();
  for (const c of comparables(snapshot, params)) {
    const list = groups.get(c.category) ?? [];
    list.push(c.ratio);
    groups.set(c.category, list);
  }
  return [...groups.entries()]
    .map(([category, ratios]) => ({ category, median_ratio: round4(median(ratios)), comps: ratios.length }))
    .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
}

/** How every protocol in the snapshot is accounted for: board, live, or excluded with a reason. */
export function coverageOf(snapshot: Snapshot, board: BoardRow[]): Coverage {
  const onBoard = new Set(board.map((r) => r.slug));
  const reasons = new Map<string, number>();
  const named: { slug: string; name: string; reason: string }[] = [];
  let live = 0;
  for (const p of snapshot.protocols) {
    if (onBoard.has(p.slug)) continue;
    if (!isPreToken(p)) {
      live++;
      continue;
    }
    const reason = exclusionReason(p) ?? 'not rankable';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    named.push({ slug: p.slug, name: p.name, reason });
  }
  named.sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const watchlist = new Set(snapshot.watchlist);
  return {
    total: snapshot.protocols.length,
    watchlist: snapshot.watchlist.length,
    board: board.length,
    early: board.filter((r) => !watchlist.has(r.slug)).length,
    live_token: live,
    excluded: [...reasons.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([reason, count]) => ({ reason, count })),
    excluded_named: named,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = PARAMS): { board: BoardRow[]; radar: RadarData } {
  const { board, curve, backtest, validation } = buildBoard(snapshot, params);
  const comps = comparables(snapshot, params);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    params,
    model_version: MODEL_VERSION,
    curve,
    global_multiple: round4(median(comps.map((c) => c.ratio))),
    categories: categoryDiagnostics(snapshot, params),
    backtest,
    validation,
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
