# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arukh89/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arukh89/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The Pre-Token Radar: every protocol that records no token, ranked by a fitted implied launch value, with a dated, costed farm plan and a verdict for each. The board covers the whole 40-protocol watchlist plus 158 early pre-token protocols below the $50M floor, all scored by one size curve learned from the snapshot's own traded protocols — a curve kept because it beat the flat multiple and every added term on two blind tests. The dashboard is a static page that renders with no network: a sortable, filterable board with the validation evidence and coverage reconciliation on it, a detail view for every protocol, a live-token view set aside from the ranking, and a model tab with the curve, the blind-test record, full coverage accounting and a curve explorer.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored make.fun library. Two runs write byte-identical output.

## The model

Implied value follows only from the snapshot's figures: a size curve, log(market cap) = a + b x log(TVL), fitted by least squares on the traded comparables, slope clamped to [0, 1]. Category multiples, a 7d-growth term and an age term were fitted and tested too, and all three were dropped: each lost to the bare curve on at least one blind test — leave-one-out, and a walk-forward split that fits on protocols listed earlier and tests on protocols listed later. The dashboard shows every variant's blind-test numbers. The leave-one-out error spread sets each row's implied range, its coverage is measured as calibration, and a seeded bootstrap of 200 refits sets a second band per row. Farm plans are derived from each protocol's own record (category, chains, TVL, age, growth): six dated steps with a cost and a time, a break-even in dollars (gas plus active time valued at $15/hour), a FARM / THIN / SKIP verdict from stated numeric rules, and a numeric exit rule.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
