# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Biose-dot/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Biose-dot/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**LaunchScope** is a token launch radar. It reads the sealed DefiLlama snapshot of 758 protocols and ranks every protocol that records no token yet — all 40 of the house watchlist plus 158 more the list leaves out, most of them below its $50M floor — by an *implied value*: what its token would be worth if it issued one today and the market priced it the way it already prices comparable live protocols. It never predicts that a token will come; it prices the launch if it does, and gives the reader a concrete farm plan for every row.

The value model is calibrated from the snapshot itself, not asserted. For each category, the model takes the live protocols the market already prices, computes their market cap / TVL multiples, winsorizes them at the market's 95th percentile, and shrinks the category median toward the market-wide median (0.214×) until the category has priced peers of its own. A protocol's base value is its TVL times its category's multiple, then three stated adjustments: a saturating growth factor from its 7-day TVL change, a maturity factor that rewards a long tokenless track record, and a breadth factor for the chains it runs on. Each row also carries the value range between its category's 25th and 75th percentile multiples. No protocol name is special-cased anywhere: one function prices every row, and the dashboard re-multiplies every row's stated components and shows the count that land on the board's exact figure.

The dashboard is a static page with no network and no framework: a sortable, filterable board (search, category, chain, watchlist/early segment), a detail view per protocol with the model's full arithmetic and a 7-step farm plan — each step with what it costs and how long it takes, derived from the protocol's category, chains, TVL and age — and a Live tokens view showing the priced peers the calibration comes from.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node.js 22.18 or later, standard library only — nothing to install. `main.ts` reads the snapshot (in the grader it defaults to `/input/snapshot.json`), and writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. The run is a pure function of the snapshot: two runs write the same bytes.

Layout: `main.ts` is the entrypoint, `lib/model.ts` holds the calibration, the pricing model and the farm-plan generator, `dashboard/` is the page, `screenshots/` are its three views, and `vendor/makefun-board.ts` is make.fun's dossier library, copied verbatim so the dossier the program writes is byte for byte the one the scorer rebuilds.

---

<sub>Entered on [make.fun](https://make.fun/?ref=z5jb9v24&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
