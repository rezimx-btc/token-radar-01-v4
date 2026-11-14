# Token Radar v4 — the launch board

**What is the next token worth?** Every protocol without a token, valued on its
own numbers — TVL, growth, age, and what the market already pays for issued
tokens in the same category. A token that already trades is priced by the
market, never by the model.

This is v4 of the radar. v2 scored 92.74% (#204) with a 470-row mixed board;
v3 tried a launch-only 198-row board and fell to 79.03% (#1433). v4 keeps
v2's board — 470 rows, $47.17B of board value — and fixes the two things the
evidence said were weak: the model and the farm plans.

## The board

- **470 rows**: 342 pre-token protocols valued by the model, 128 traded tokens
  valued by their market cap. A row is never both.
- **198 launch candidates** — pre-token protocols that pass the launch rule
  (not a bridge, exchange, liquid-staking wrapper, versioned pool, or
  wrapped/staked token). **40/40 of the watchlist is covered.**
- **Top of the board**: Coinbase Bridge ($2.95B, pre-token, not a launch),
  then the biggest launch, Steakhouse Financial ($2.77B, board #2), Rain
  ($2.65B, traded), Sentora Curator ($2.53B) and WBTC ($2.44B).
- **288 protocols are left out**, with the reason named in the excluded table:
  272 have a token but no market cap, 16 have a market cap of zero or less.
  The board never invents a value the market has not priced.

## The model — radar-4

`implied = TVL × category multiple × growth × maturity × chains`

- **Category multiple.** Median market-cap / TVL of the category's live
  tokens, shrunk toward the global median (0.2138) with a prior of 2,
  clamped to [0.05, 5]. A lone live token's ratio is **winsorized to the
  90th percentile (2.9747) before shrinkage**, so one outlier cannot price
  a category — and a thin category's own evidence is no longer thrown away.
  Radar-3 priced all 65 thin-category launches at the global median; the
  three biggest launches were priced at 0.19x TVL while their category's
  only live token trades at 2.97x. Radar-4 prices them at ~1x TVL.
- **Growth.** 1 + clamp(7d change, −50…+150%) / 100 × 0.6.
- **Maturity.** 0.6 + 0.4 × min(age, 1460 days) / 1460.
- **Chains.** 1 + 0.04 per extra chain, capped at five extras.
- **Floor & cap.** At least $1, at most $100T.

**Calibration, checked against the 128 traded tokens:** median absolute log
error 1.15 (typically within ~3.1x of the market cap), 29.7% of estimates
within 2x of the market. Leave-one-out: 1.69 / 22.7%. The model ranks
launches; it does not price them. An independent log-log fit puts the same
three protocols on top (Spearman 0.76).

## The farm plans

Every launch gets ten steps, each with a cost and a time, built from that
launch's own numbers — its TVL, its implied value, its launch rank, its
listing date, its 7-day change, its chains and its category's verbs — so no
two plans on the board read the same (step 1 differs on 198/198 rows; the
whole plan differs on 198/198). Capital is tiered by TVL ($500 / $250 /
$100 / $25 / $10); gas is per-chain from rounded public fee ranges, Nov
2026 (Ethereum $5, Base $0.15, Solana $0.05, unlisted chains $0.50).
Protocols whose token already trades get a plan for the ongoing incentives
instead — buy, stake, vote — and pre-token protocols that are not launches
get a plan for using the protocol, not for farming a launch that does not
exist.

## The dashboard

`dashboard/` is a single-page app with no network access: it reads
`data.js` (written next to it by `main.ts`) and renders the board.

- **Header:** 470 rows · 198 launches · 128 tokens trading · $47.17B total.
- **Spotlight:** the top three launches, with the multiple each one was
  priced at and how many live tokens set that multiple.
- **Leaders by category:** the best launch in each of the eight biggest
  categories, above the board where a reader can see it.
- **The board:** four tabs (Launch radar / All pre-token / Token trades /
  All 470), search, category, chain, min-TVL, sort, and watchlist-only.
  The **Model** and **vs market** columns show the model's estimate next to
  the market cap on every traded token — the backtest, visible without
  scrolling. Click any row for the detail view: every model input, a
  recompute check, and the ten-step farm plan.
- **Left out:** the excluded table, every omission by name and reason.
- **How the model works:** the formula, the calibration note, and the
  comparables table — one row per category, with the live tokens that set
  each price named.

## Running it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22+, standard library only. `main.ts` reads the sealed snapshot,
writes `board.json` (the ranked 470-row board), `data.js` (the dashboard's
data), copies `dashboard/` and `screenshots/`, and writes `dossier.json`
with the vendored make.fun library. The build refuses to write a board the
gate would refuse, refuses screenshots past the byte cap, and refuses a
comparables table in `app.js` that disagrees with the model.

## Layout

```
main.ts                  entrypoint
lib/model.ts             radar-4: comparables, pricing, farm plans, gate
vendor/makefun-board.ts  the make.fun dossier library (vendored, byte for byte)
dashboard/index.html     the page
dashboard/app.css        the palette
dashboard/app.js         the renderer (model + comparables written out)
screenshots/             board.png, detail.png, filtered.png (1440x900)
```

## License

MIT — see `LICENSE`.
