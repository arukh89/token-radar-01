# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arukh89/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arukh89/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The Pre-Token Radar: every protocol that records no token, ranked by a fitted implied launch value, with a costed farm plan for each. The board covers the whole 40-protocol watchlist plus 158 early pre-token protocols below the $50M floor, all scored by one comparables-fitted model learned from the snapshot's own traded protocols. The dashboard is a static page that renders with no network: a sortable, filterable board, a detail view for every protocol, a live-token view set aside from the ranking, and a model tab with the fit, a leave-one-out backtest, full coverage accounting and a sandbox.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored make.fun library. Two runs write byte-identical output.

## The model

Implied value follows only from the snapshot's figures: TVL x a fitted multiple x growth x maturity. The multiple is the category's median market-cap/TVL ratio among traded comparables in the same snapshot, winsorised, shrunk toward the global median, and capped; categories with fewer than 3 comparables take the global median. A leave-one-out backtest scores the fit against the traded protocols it learned from, and its error spread sets each row's implied range. Farm plans are derived from each protocol's own record (category, chains, TVL, age): six concrete steps with a cost and a time, plus capital, gas, active-time and hold totals.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
