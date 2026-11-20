# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/arukh89/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/arukh89/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

The Pre-Token Radar: every protocol that records no token, ranked by a fitted implied launch value, with a dated, costed farm plan and a verdict for each. The board covers the whole 40-protocol watchlist plus 158 early pre-token protocols below the $50M floor, all scored by one size curve learned from the snapshot's own traded protocols — a curve kept because it beat the flat multiple and every added term on two blind tests. Growth and age enter through a second, cross-validated model, launch odds — a logistic regression on size, growth, age and the six most common categories — which scales each plan's break-even to an expectation-positive bar. The dashboard is a static page that renders with no network: a sortable, filterable board with the validation evidence and coverage reconciliation on it, a detail view for every protocol, a live-token view set aside from the ranking, and a model tab with the curve, the blind-test record, the launch-odds calibration, full coverage accounting and a curve explorer.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) reads the sealed snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored make.fun library. Two runs write byte-identical output.

## The model

Implied value follows only from the snapshot's figures: a size curve, log(market cap) = a + b x log(TVL), fitted by least squares on the traded comparables, slope clamped to [0, 1]. Category multiples, a 7d-growth term and an age term were fitted and tested too, and all three were dropped from the value: each lost to the bare curve on at least one blind test — leave-one-out, and a walk-forward split that fits on protocols listed earlier and tests on protocols listed later. The dashboard shows every variant's blind-test numbers. The leave-one-out error spread sets each row's implied range (plus a wider 80% band from the error deciles), each band's coverage is measured as calibration, and a seeded bootstrap of 200 refits sets a third band per row. Growth, age and category are not wasted: a logistic regression on log TVL, growth, age and one-hot flags for the six most common categories (counted from the data, re-counted per fold), fitted on every non-product protocol in the snapshot, estimates launch odds — the base rate at which protocols of a given size, growth, age and category record a token, cross-validated against the base rate (AUC 0.7561, log-loss 0.5850 vs 0.6877) and labelled a base rate, never a forecast. Category predicts token status, not value: the same terms lost as value terms. A farm pays only when its expected allocation covers its costs: launch odds x a 10% farmers' pool share of the implied value x (ticket / TVL), minus gas, time at $15/hour and 4% a year forgone on the $1,000 ticket. At that default, 7 rows pay (median break-even ticket $3,365.50); the rest are THIN or SKIP by the fixed rules, and the dashboard re-runs the net live at other tickets and pool shares. Farm plans are derived from each protocol's own record (category, chains, TVL, age, growth): seven dated steps with a cost and a time, including a mechanism step that states what activity counts, a break-even in dollars (gas plus active time valued at $15/hour) and an expectation break-even scaled by launch odds, a FARM / THIN / SKIP verdict from stated numeric rules, and a numeric exit rule.

---

Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
