# ETF Relative-Momentum Research

## Status

Research only. This model is not connected to the paper coordinator and the results do not establish
future profitability. Its current purpose is to test a lower-volatility portfolio hypothesis using
real adjusted Alpaca bars without creating broker state.

## Data

Run `npm run research:download-etfs` with Alpaca data credentials to write the ignored local file
`test-fixtures/data/alpaca-etf-daily.json`. The default universe is `SPY,QQQ,IWM,IEF,GLD`; requests
use the IEX feed, daily timeframe, and `adjustment=all`.

The 2026-09-07 download returned 7,681 bars. Common history for all five symbols spans 2020-07-27
through 2026-09-04. This is materially shorter than the desired 10–15 years and covers a favorable
period for US equities, so it is not sufficient promotion evidence.

## Model

- Rebalance monthly at the next available open.
- Calculate every signal exclusively from prior closes.
- Require positive 126-day momentum and price above its 200-day average.
- Rank eligible ETFs by momentum divided by annualized 20-day volatility.
- Hold at most two ETFs.
- Target 10% annualized volatility, capped at 40% per asset and 80% gross exposure.
- Hold residual capital in cash.
- Charge 10 basis points on traded notional; a 25-basis-point stress case is included.

Run `npm run research:etf-momentum` to reproduce the base result and parameter sensitivity checks.

## Initial result

The base model returned 47.88% with 10.55% maximum drawdown and a 0.84 zero-rate Sharpe estimate.
The matched 80%-SPY benchmark returned 75.17% with 19.90% maximum drawdown and a 0.78 Sharpe
estimate. The model therefore did not improve absolute return, but it reduced observed drawdown and
slightly improved return per unit of observed volatility.

Momentum windows of 63, 126, and 189 sessions all remained profitable, while the 63-session version
had the most turnover and weakest result. Trend windows from 150 through 250 sessions produced
similar results; the 250-session variant had the best observed Sharpe and drawdown. Raising assumed
cost from 10 to 25 basis points reduced the base result from 47.88% to 42.45%, demonstrating material
turnover sensitivity.

## Promotion gates

Before coordinator integration:

1. Obtain at least 10 years of point-in-time history or explicitly accept the shorter evidence.
2. Add rolling out-of-sample evaluation with frozen parameter selection.
3. Include a positive risk-free cash return and total-return benchmark validation.
4. Attribute returns by symbol, regime, and year and test delayed/missed rebalances.
5. Add a portfolio-allocation boundary; do not force cross-symbol ranking into the per-symbol
   `Strategy` interface.
6. Add news only as a separately tested event veto, with publication timestamps and duplicate-story
   handling.
7. Complete a dry-run soak before any order-submitting paper use.
