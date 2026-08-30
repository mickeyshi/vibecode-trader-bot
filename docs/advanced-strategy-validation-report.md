# Advanced Strategy Validation Report

Generated: 2026-08-02T18:22:19.176Z

> Research status: framework validation on deterministic synthetic fixtures. These results do not establish profitability or suitability for live capital.

## Method

Each strategy used its registered default parameters, with no tuning on these scenarios. Every run used the shared signal -> intent -> risk -> paper executor -> portfolio replay path and the same 10% target allocation, preventing repeated buy signals from creating unequal benchmark exposure. Buy-and-hold is the benchmark. Base friction is 0.10% fee, 5 bps slippage, and 5 bps spread; stressed friction is 0.25% fee, 20 bps slippage, and 20 bps spread. Orders fill immediately and completely at the modeled candle close. The calendar is weekday-only with no holidays, dividends, taxes, latency, liquidity, corporate actions, or short selling.

The fixtures contain 90 daily candles from 2024-01-02 onward and intentionally represent distinct regimes. They are deterministic test inputs, not sampled market history, so the report vets mechanics and directional behavior rather than forecasting skill.

## Base-friction results

| Scenario          | Strategy                | Return | Effect vs benchmark | Max drawdown | Closed trades | Filled orders |
| ----------------- | ----------------------- | -----: | ------------------: | -----------: | ------------: | ------------: |
| persistent-trend  | buy-and-hold            |  3.21% |            +0.00 pp |        0.47% |             0 |             1 |
| persistent-trend  | volatility-breakout     |  0.00% |            -3.21 pp |        0.00% |             0 |             0 |
| persistent-trend  | trend-filtered-momentum |  2.62% |            -0.59 pp |        0.16% |             2 |             3 |
| persistent-trend  | scored-context          |  2.98% |            -0.23 pp |        0.30% |             2 |             4 |
| breakout-reversal | buy-and-hold            |  0.15% |            +0.00 pp |        3.13% |             0 |             1 |
| breakout-reversal | volatility-breakout     |  2.11% |            +1.96 pp |        0.86% |             2 |             3 |
| breakout-reversal | trend-filtered-momentum |  2.65% |            +2.50 pp |        0.33% |             2 |             3 |
| breakout-reversal | scored-context          |  1.90% |            +1.75 pp |        0.84% |             6 |            11 |
| volatile-chop     | buy-and-hold            |  0.25% |            +0.00 pp |        1.09% |             0 |             1 |
| volatile-chop     | volatility-breakout     |  0.00% |            -0.25 pp |        0.00% |             0 |             0 |
| volatile-chop     | trend-filtered-momentum |  0.31% |            +0.06 pp |        0.74% |            18 |            31 |
| volatile-chop     | scored-context          |  0.00% |            -0.25 pp |        0.00% |             0 |             0 |

## Friction sensitivity

| Strategy                | Base average return | Stressed average return |   Change | Positive base scenarios |
| ----------------------- | ------------------: | ----------------------: | -------: | ----------------------: |
| volatility-breakout     |               0.70% |                   0.67% | -0.03 pp |                     1/3 |
| trend-filtered-momentum |               1.86% |                   1.50% | -0.36 pp |                     3/3 |
| scored-context          |               1.63% |                   1.47% | -0.16 pp |                     2/3 |

## Vetted effects

- **volatility-breakout:** benchmark-relative return by regime: persistent-trend -3.21 pp, breakout-reversal +1.96 pp, volatile-chop -0.25 pp.
- **trend-filtered-momentum:** benchmark-relative return by regime: persistent-trend -0.59 pp, breakout-reversal +2.50 pp, volatile-chop +0.06 pp.
- **scored-context:** benchmark-relative return by regime: persistent-trend -0.23 pp, breakout-reversal +1.75 pp, volatile-chop -0.25 pp.

The comparison shows conditional effects, not a universal ranking. A strategy is mechanically useful only if its signals, risk path, and regime response match its design; promotion requires real point-in-time data, walk-forward or rolling out-of-sample tests, parameter-stability analysis, and realistic liquidity/execution modeling.

## Scenario definitions

- **persistent-trend:** A quiet initial range followed by a sustained advance and a mild late pullback.
- **breakout-reversal:** A long range, an abrupt upside breakout, continuation, then a breakdown reversal.
- **volatile-chop:** Large alternating moves around a flat center with no persistent direction.
