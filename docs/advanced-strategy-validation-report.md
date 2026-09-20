# Advanced Strategy Validation Report

Generated: 2026-09-20T23:54:34.327Z

> Research status: framework validation on deterministic synthetic fixtures. These results do not establish profitability or suitability for live capital.

## Method

Each strategy used its registered default parameters, with no tuning on these scenarios. Every run used the shared signal -> intent -> risk -> paper executor -> portfolio replay path and the same 10% target allocation, preventing repeated buy signals from creating unequal benchmark exposure. Buy-and-hold is the benchmark. Base friction is 0.10% fee, 5 bps slippage, 5 bps spread, and up to 10 bps linear market impact; stressed friction is 0.25% fee, 20 bps slippage, 20 bps spread, and up to 25 bps impact. Fills are capped cumulatively at 1% of each modeled candle's volume. The calendar is weekday-only with no holidays, dividends, taxes, latency, corporate actions, short selling, or order-book queue modeling.

The fixtures contain 90 daily candles from 2024-01-02 onward and intentionally represent distinct regimes. They are deterministic test inputs, not sampled market history, so the report vets mechanics and directional behavior rather than forecasting skill.

## Base-friction results

| Scenario          | Strategy                | Return | Effect vs benchmark | Max drawdown | Closed trades | Filled orders |
| ----------------- | ----------------------- | -----: | ------------------: | -----------: | ------------: | ------------: |
| persistent-trend  | buy-and-hold            |  3.20% |            +0.00 pp |        0.47% |             0 |             1 |
| persistent-trend  | volatility-breakout     |  0.00% |            -3.20 pp |        0.00% |             0 |             0 |
| persistent-trend  | trend-filtered-momentum |  2.61% |            -0.60 pp |        0.17% |             2 |             3 |
| persistent-trend  | scored-context          |  2.97% |            -0.24 pp |        0.31% |             2 |             4 |
| breakout-reversal | buy-and-hold            |  0.14% |            +0.00 pp |        3.13% |             0 |             1 |
| breakout-reversal | volatility-breakout     |  2.09% |            +1.95 pp |        0.87% |             2 |             3 |
| breakout-reversal | trend-filtered-momentum |  2.63% |            +2.50 pp |        0.34% |             2 |             3 |
| breakout-reversal | scored-context          |  1.80% |            +1.66 pp |        0.92% |             6 |            11 |
| volatile-chop     | buy-and-hold            |  0.24% |            +0.00 pp |        1.09% |             0 |             1 |
| volatile-chop     | volatility-breakout     |  0.00% |            -0.24 pp |        0.00% |             0 |             0 |
| volatile-chop     | trend-filtered-momentum |  0.07% |            -0.16 pp |        0.78% |            18 |            31 |
| volatile-chop     | scored-context          |  0.00% |            -0.24 pp |        0.00% |             0 |             0 |

## Friction sensitivity

| Strategy                | Base average return | Stressed average return |   Change | Positive base scenarios |
| ----------------------- | ------------------: | ----------------------: | -------: | ----------------------: |
| volatility-breakout     |               0.70% |                   0.66% | -0.04 pp |                     1/3 |
| trend-filtered-momentum |               1.77% |                   1.27% | -0.50 pp |                     3/3 |
| scored-context          |               1.59% |                   1.37% | -0.21 pp |                     2/3 |

## Vetted effects

- **volatility-breakout:** benchmark-relative return by regime: persistent-trend -3.20 pp, breakout-reversal +1.95 pp, volatile-chop -0.24 pp.
- **trend-filtered-momentum:** benchmark-relative return by regime: persistent-trend -0.60 pp, breakout-reversal +2.50 pp, volatile-chop -0.16 pp.
- **scored-context:** benchmark-relative return by regime: persistent-trend -0.24 pp, breakout-reversal +1.66 pp, volatile-chop -0.24 pp.

The comparison shows conditional effects, not a universal ranking. A strategy is mechanically useful only if its signals, risk path, and regime response match its design; promotion requires real point-in-time data, walk-forward or rolling out-of-sample tests, parameter-stability analysis, and realistic liquidity/execution modeling.

## Scenario definitions

- **persistent-trend:** A quiet initial range followed by a sustained advance and a mild late pullback.
- **breakout-reversal:** A long range, an abrupt upside breakout, continuation, then a breakdown reversal.
- **volatile-chop:** Large alternating moves around a flat center with no persistent direction.
