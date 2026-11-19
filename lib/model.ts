// LaunchScope's model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// The question the board answers: if this protocol issued a token today and the market priced it the
// way it already prices comparable live protocols, what would that token be worth, and what should a
// reader do to be farming it when it arrives? The board never predicts that a token will come.
//
// The implied value is calibrated, not asserted. The snapshot itself carries the market's revealed
// prices for the protocols whose tokens already trade: for every live protocol, market cap over TVL.
// A pre-token protocol's base value is its TVL times the multiple the market pays for its own
// category, shrunk toward the market-wide median when the category has few priced peers:
//
//   peers(cat)   = live protocols in cat with a recorded market cap, multiple = mcap_usd / tvl_usd,
//                  winsorized at the market-wide 95th percentile so one extreme token cannot price
//                  a whole category
//   multiple(cat)= (n * median(peers) + SHRINK_K * globalMedian) / (n + SHRINK_K), SHRINK_K = 10:
//                  a category earns its own multiple only as its priced peers add up
//   base         = tvl_usd * multiple(cat)
//   growthF      = 1 + 0.85 * tanh(clamp(change_7d, -50, 150) / 55)   (saturating: one hot week
//                  moves the value, it does not decide it)
//   maturityF    = 0.55 + 0.50 * ln(1 + age_days) / ln(1 + 1826)      (a track record with no token
//                  is worth more, with diminishing returns; unknown age scores the median age)
//   breadthF     = 1 + 0.025 * min(chains - 1, 8)                     (distribution is a moat)
//   implied      = round(base * growthF * maturityF * breadthF), at least 1
//   implied_low / implied_high use the category's shrunk 25th / 75th percentile multiples instead.
//
// No protocol name is ever special-cased: one function scores every row, and the dashboard
// recomputes every row from the same figures and shows the count that agree.

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

/** The model's version label, named in the dashboard and in board.json. */
export const MODEL_VERSION = 'launchscope-2';

/** How hard a thin category's own median is shrunk toward the market-wide median. */
export const SHRINK_K = 10;
/** Peer multiples are winsorized at this global quantile before any median is taken. */
export const WINSOR_QUANTILE = 0.95;
/** The seven-day growth clamp, in per cent, before the saturating curve sees it. */
export const GROWTH_FLOOR = -50;
export const GROWTH_CAP = 150;
/** The growth curve: factor = 1 + GROWTH_GAIN * tanh(pct / GROWTH_SCALE). */
export const GROWTH_GAIN = 0.85;
export const GROWTH_SCALE = 55;
/** The maturity curve: factor = MATURITY_BASE + MATURITY_GAIN * ln(1 + age) / ln(1 + MATURITY_DAYS). */
export const MATURITY_BASE = 0.55;
export const MATURITY_GAIN = 0.5;
export const MATURITY_DAYS = 1826;
/** The breadth premium: BREADTH_PER_CHAIN per extra chain, up to BREADTH_MAX_EXTRA chains. */
export const BREADTH_PER_CHAIN = 0.025;
export const BREADTH_MAX_EXTRA = 8;

/** One category's calibration: how the market prices its live protocols. */
export interface CategoryCalibration {
  category: string;
  peers: number;
  multiple: number;
  low: number;
  high: number;
}

/** The whole calibration the snapshot's live set produces. */
export interface Calibration {
  peer_count: number;
  global_multiple: number;
  global_low: number;
  global_high: number;
  median_age_days: number;
  by_category: Map<string, CategoryCalibration>;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    peer_multiple: number;
    peer_low: number;
    peer_high: number;
    peer_count: number;
    growth_pct: number;
    growth_factor: number;
    maturity_factor: number;
    breadth_factor: number;
    age_days: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the board row's figures plus its plan as steps. */
export interface RadarRow extends Omit<BoardRow, 'farm_steps'> {
  farm_steps: FarmStep[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  change_7d: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  counts: { protocols: number; pre_token: number; board: number; watchlist: number; early: number; live: number };
  calibration: {
    peer_count: number;
    global_multiple: number;
    global_low: number;
    global_high: number;
    median_age_days: number;
    categories: { category: string; peers: number; multiple: number; low: number; high: number }[];
  };
  rows: RadarRow[];
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

/** A whole day count from listed_at to as_of, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The value at fraction q of a sorted, non-empty array. */
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token the market prices (a calibration peer). */
function isPricedPeer(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && (p.gecko_id !== null || p.symbol !== null);
}

/**
 * The calibration: what the market pays per dollar of TVL, overall and per category, read off the
 * snapshot's own live protocols. Category figures are shrunk toward the global ones by peer count,
 * so a category with two priced peers cannot set a wild multiple on its own.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const peers = snapshot.protocols.filter(isPricedPeer);
  // Winsorize first: a peer whose token trades at hundreds of times its TVL is a fact about that
  // token, not a price for a whole category, so no peer counts past the market's 95th percentile.
  const raw = peers.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const cap = raw.length > 0 ? quantile(raw, WINSOR_QUANTILE) : 0;
  const multipleOf = (p: SnapshotProtocol): number => Math.min(p.mcap_usd! / p.tvl_usd, cap);
  const multiples = peers.map(multipleOf).sort((a, b) => a - b);
  const globalMultiple = multiples.length > 0 ? quantile(multiples, 0.5) : 0.2;
  const globalLow = multiples.length > 0 ? quantile(multiples, 0.25) : globalMultiple * 0.4;
  const globalHigh = multiples.length > 0 ? quantile(multiples, 0.75) : globalMultiple * 3;
  const shrink = (own: number, n: number, global: number): number => (n * own + SHRINK_K * global) / (n + SHRINK_K);

  const byCategory = new Map<string, CategoryCalibration>();
  const grouped = new Map<string, number[]>();
  for (const p of peers) {
    if (p.category === null) continue;
    const list = grouped.get(p.category) ?? [];
    list.push(multipleOf(p));
    grouped.set(p.category, list);
  }
  for (const [category, list] of grouped) {
    const sorted = [...list].sort((a, b) => a - b);
    byCategory.set(category, {
      category,
      peers: list.length,
      multiple: shrink(quantile(sorted, 0.5), list.length, globalMultiple),
      low: shrink(quantile(sorted, 0.25), list.length, globalLow),
      high: shrink(quantile(sorted, 0.75), list.length, globalHigh),
    });
  }

  const ages = snapshot.protocols
    .filter(isPreToken)
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const medianAge = ages.length > 0 ? quantile(ages, 0.5) : 365;
  return { peer_count: peers.length, global_multiple: globalMultiple, global_low: globalLow, global_high: globalHigh, median_age_days: Math.round(medianAge), by_category: byCategory };
}

/** The calibration one protocol is priced with: its category's, or the market-wide one. */
function calibrationFor(cal: Calibration, category: string | null): CategoryCalibration {
  if (category !== null) {
    const own = cal.by_category.get(category);
    if (own !== undefined) return own;
  }
  return { category: category ?? 'Uncategorised', peers: 0, multiple: cal.global_multiple, low: cal.global_low, high: cal.global_high };
}

/** The model's three factors and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  cal: Calibration,
  asOf: string,
): { implied: number; low: number; high: number; growthPct: number; growthF: number; maturityF: number; breadthF: number; age: number | null; modelAge: number; peer: CategoryCalibration } {
  const peer = calibrationFor(cal, p.category);
  const age = ageDays(asOf, p.listed_at);
  const modelAge = age ?? cal.median_age_days;
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, rawGrowth));
  // Every component is rounded to 4 decimals before it is multiplied in, so the dashboard can
  // re-multiply a row's stated components and land on the board's exact figure.
  const growthF = round4(1 + GROWTH_GAIN * Math.tanh(growthPct / GROWTH_SCALE));
  const maturityF = round4(MATURITY_BASE + MATURITY_GAIN * (Math.log(1 + Math.min(modelAge, MATURITY_DAYS * 2)) / Math.log(1 + MATURITY_DAYS)));
  const breadthF = round4(1 + BREADTH_PER_CHAIN * Math.min(Math.max(p.chains.length - 1, 0), BREADTH_MAX_EXTRA));
  const multiple = round4(peer.multiple);
  const lowMultiple = round4(peer.low);
  const highMultiple = round4(peer.high);
  const factors = growthF * maturityF * breadthF;
  return {
    implied: Math.max(1, Math.round(p.tvl_usd * multiple * factors)),
    low: Math.max(1, Math.round(p.tvl_usd * lowMultiple * factors)),
    high: Math.max(1, Math.round(p.tvl_usd * highMultiple * factors)),
    growthPct,
    growthF,
    maturityF,
    breadthF,
    age,
    modelAge,
    peer,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is another protocol's pool. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are products of a token that already trades, not launches of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Names that mark a wrapped or staked product of another asset. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a product may not begin with: it is the exchange's own wrapper, not a launch. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a pre-token protocol is a launch candidate for the early radar: not a versioned pool, not
 * a wrapped, staked or bridged product of a token that already trades, and not an exchange itself.
 * The watchlist's own rows are always ranked, whatever this says: the house already filtered them.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_NAME.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** A step as one board string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and log it.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs in gas on a chain, in dollars, by the chain's class. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Solana') return 0.05;
  if (chain === 'Bitcoin') return 1.5;
  if (chain === 'BSC' || chain === 'BNB Chain') return 0.3;
  return 0.5;
}

/** Gas as the words a step carries. */
function gasText(chain: string): string {
  const g = gasFor(chain);
  if (g < 0.1) return 'under $0.10 of gas';
  if (g < 1) return `about $${g.toFixed(2)} of gas`;
  return `about $${g.toFixed(0)} of gas`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 540) return 45;
  return 30;
}

/** The category playbook: the core action and the second, different action a farmer takes. */
function playbook(p: SnapshotProtocol, capital: number, chain: string): { core: string; second: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      core: `Supply $${capital} of USDC as collateral in ${name} on ${chain}, then borrow against it at under 40% of the limit and supply the borrowed amount back once.`,
      second: `Repay part of the borrow and re-supply it a week later, so the wallet shows a full lend-and-borrow cycle rather than one deposit.`,
    };
  }
  if (c.includes('dex') || c.includes('aggregator')) {
    return {
      core: `Add $${capital} of liquidity to ${name}'s deepest stable or blue-chip pool on ${chain}, split evenly between the two assets, and make three swaps through the same interface.`,
      second: `Move a quarter of the position into a second pool with a different pair, so the wallet is active in more than one market the protocol runs.`,
    };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) {
    return {
      core: `Deposit $${capital} of USDC as margin on ${name} and open one small position hedged with an equal spot holding elsewhere, so the farm carries no directional bet.`,
      second: `Close and reopen the hedge once a week at the same size, keeping the margin account active without growing the risk.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      core: `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then use the bridged funds in one app on the far side instead of bridging straight back.`,
      second: `Bridge a smaller second amount on a different day and from a different source chain if ${name} supports one, so the history is not a single round trip.`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      core: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet, unstaked and unspent.`,
      second: `Claim or compound any staking rewards once, from the protocol's own page, so the wallet shows it manages the position.`,
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return {
      core: `Deposit $${capital} into the largest ${name} vault on ${chain} and keep the vault shares; a curator's record is its depositors, so be one early.`,
      second: `Add a second, smaller deposit two weeks later rather than topping up daily, which reads as a considered position, not dust.`,
    };
  }
  if (c.includes('yield') || c.includes('farm')) {
    return {
      core: `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and leave the shares untouched; vault share history is what a snapshot reads.`,
      second: `Harvest the yield once and redeposit it, so the wallet shows it works the position instead of parking it.`,
    };
  }
  if (c.includes('stable') || c.includes('synth')) {
    return {
      core: `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the wallet rather than selling it on.`,
      second: `Use part of the stable balance in one of the protocol's own partner pools it links to, keeping the activity inside its ecosystem.`,
    };
  }
  if (c.includes('rwa') || c.includes('real world')) {
    return {
      core: `Subscribe $${capital} to ${name}'s yield product on ${chain} once any onboarding it asks for is done, and hold the position to term.`,
      second: `Hold through one full payout or reporting cycle, which is the record a real-world-asset protocol can actually verify.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      core: `Fund $${capital} on ${name} and take one position in its most liquid market, sized so a total loss is acceptable.`,
      second: `Settle the position at expiry and take one more in a different market, so the account has a settled history, not an open bet.`,
    };
  }
  if (c.includes('insurance')) {
    return {
      core: `Buy $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy to its end date.`,
      second: `Renew the cover once when it lapses, so the wallet shows a continuing customer, not a one-off.`,
    };
  }
  if (c.includes('nft') || c.includes('gaming') || c.includes('game')) {
    return {
      core: `Spend up to $${capital} inside ${name} on ${chain} on the assets or passes its regular users hold, and use them the way the product intends.`,
      second: `Come back on three separate days for the product's own daily or seasonal activity, which is the usage record it can see.`,
    };
  }
  if (c.includes('privacy') || c.includes('zk')) {
    return {
      core: `Deposit $${capital} through ${name}'s own interface on ${chain} exactly as its documentation describes, and keep the resulting balance or note.`,
      second: `Make one withdrawal or transfer through the same interface a week later, completing the round trip a real user makes.`,
    };
  }
  return {
    core: `Deposit $${capital} of USDC into ${name} on ${chain} through its own app and keep the position open; if it offers several products, use the one holding the most TVL.`,
    second: `Repeat the core action once at half size two weeks later, so the wallet's history spans more than a single day.`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(4, Math.min(10, Math.round(hold / 7)));
  const gas = gasText(chain);
  const { core, second } = playbook(p, capital, chain);
  return [
    {
      text: `Set up a fresh wallet for ${p.name} alone, write its seed phrase on paper, and never reuse a wallet that holds your main funds.`,
      cost: 'nothing but the wallet',
      time: '10 minutes',
    },
    {
      text: `Fund that wallet on ${chain} with $${capital} of working capital plus the chain's gas token; if you start elsewhere, bridge once and keep the bridge receipt.`,
      cost: `$${capital} of capital and ${gas} for the funding transaction`,
      time: '15 minutes',
    },
    { text: core, cost: `$${capital} committed and ${gas}`, time: '20 minutes to set up' },
    { text: second, cost: `${gas} per transaction`, time: '15 minutes' },
    {
      text: `Return once a week for ${weeks} weeks and make one small qualifying transaction each visit — a deposit, a swap, a vote or a claim — so no single week carries the whole record.`,
      cost: `${gas} a week, about $${(gasFor(chain) * weeks).toFixed(2)} in all`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days in total, and once a month open ${p.name}'s own points, rewards or governance page to confirm the wallet is being counted.`,
      cost: `the $${capital} stays committed for ${hold} days`,
      time: `${hold} days, 5 minutes a month to check`,
    },
    {
      text: `Keep a farm log of the wallet, the dates and every transaction hash; if a token or claim is ever announced, use only the link on the protocol's own page, and never pay anyone to claim for you.`,
      cost: 'nothing, and never a claim fee',
      time: '5 minutes a week',
    },
  ];
}

/** The board: every watchlist row plus every other launch candidate, ranked by implied value. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; radarRows: RadarRow[]; cal: Calibration } {
  const cal = calibrate(snapshot);
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isLaunchCandidate(p));
  const scored = chosen.map((p) => ({ p, v: impliedValue(p, cal, snapshot.as_of) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => {
    const steps = farmSteps(s.p, s.v.age);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      token_status: 'pre-token',
      watchlist: watch.has(s.p.slug),
      age_days: s.v.age,
      implied_value_usd: s.v.implied,
      implied_low_usd: s.v.low,
      implied_high_usd: s.v.high,
      model: {
        peer_multiple: round4(s.v.peer.multiple),
        peer_low: round4(s.v.peer.low),
        peer_high: round4(s.v.peer.high),
        peer_count: s.v.peer.peers,
        growth_pct: round4(s.v.growthPct),
        growth_factor: round4(s.v.growthF),
        maturity_factor: round4(s.v.maturityF),
        breadth_factor: round4(s.v.breadthF),
        age_days: s.v.modelAge,
      },
      farm_steps: steps.map(stepText),
    };
  });
  const radarRows: RadarRow[] = board.map((row, i) => ({ ...row, farm_steps: farmSteps(scored[i]!.p, scored[i]!.v.age) }));
  return { board, radarRows, cal };
}

/** The live-token protocols, by market cap: the calibration's evidence, shown apart from the board. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter(isPricedPeer)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, 36)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, radarRows, cal } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      board: board.length,
      watchlist: snapshot.watchlist.length,
      early: board.filter((r) => !r.watchlist).length,
      live: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    },
    calibration: {
      peer_count: cal.peer_count,
      global_multiple: round4(cal.global_multiple),
      global_low: round4(cal.global_low),
      global_high: round4(cal.global_high),
      median_age_days: cal.median_age_days,
      categories: [...cal.by_category.values()]
        .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1))
        .map((c) => ({ category: c.category, peers: c.peers, multiple: round4(c.multiple), low: round4(c.low), high: round4(c.high) })),
    },
    rows: radarRows,
    live,
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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows one by one. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (slugs.has(r.slug)) return `${r.slug} appears twice`;
    slugs.add(r.slug);
    if (r.name.length === 0) return `${r.slug} has an empty name`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value: not a ranking';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
