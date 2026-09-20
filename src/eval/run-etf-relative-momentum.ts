import { DEFAULT_ETF_MOMENTUM_CONFIG, runEtfRelativeMomentum } from "./etf-relative-momentum.js";
import { loadResearchDataset } from "./research-candle-loader.js";

const path = process.argv[2] ?? "test-fixtures/data/alpaca-etf-daily.json";
const dataset = await loadResearchDataset(path);
const candles = dataset.candles;

const configurations = [
  DEFAULT_ETF_MOMENTUM_CONFIG,
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, momentumWindow: 63 },
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, momentumWindow: 189 },
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, trendWindow: 150 },
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, trendWindow: 250 },
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, transactionCostBps: 25 },
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, rebalanceDelaySessions: 1 },
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, rebalanceDelaySessions: 5 },
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, skipEveryNthRebalance: 3 },
  { ...DEFAULT_ETF_MOMENTUM_CONFIG, cashAnnualYieldPct: 4 }
];
const results = configurations.map((configuration) => ({
  configuration,
  result: runEtfRelativeMomentum(candles, configuration)
}));
console.log(
  JSON.stringify(
    {
      researchOnly: true,
      dataProvenance: {
        source: dataset.source,
        adjustment: dataset.adjustment,
        corporateActionAdjustments: dataset.corporateActionAdjustments,
        requestedAt: dataset.requestedAt,
        requestedRange: { from: dataset.from, to: dataset.to }
      },
      benchmarkDefinition: {
        symbol: "SPY",
        grossWeight: DEFAULT_ETF_MOMENTUM_CONFIG.maxGrossWeight,
        residualAsset: "cash",
        interpretation:
          "Provider-adjusted SPY return proxy; not independently cross-validated against another total-return vendor."
      },
      methodology:
        "Monthly selection uses only prior closes and executes at the next available open; adjusted Alpaca IEX daily bars; cash allowed; no news signal.",
      limitations: [
        "Available histories begin between 2018-11-01 and 2020-07-27, depending on symbol.",
        "No taxes, market impact, borrow, intraday execution, or point-in-time constituent changes.",
        "Delayed scenarios move each monthly rebalance by one or five common trading sessions.",
        "The missed-rebalance scenario skips every third scheduled rebalance deterministically.",
        "The cash-yield scenario applies a constant 4% annual yield and Sharpe hurdle, not a historical rate series.",
        "Parameter variants are sensitivity checks, not independent out-of-sample proof."
      ],
      results
    },
    null,
    2
  )
);
