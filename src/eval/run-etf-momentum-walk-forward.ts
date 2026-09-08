import { runEtfMomentumWalkForward } from "./etf-momentum-walk-forward.js";
import { loadResearchCandles } from "./research-candle-loader.js";

const path = process.argv[2] ?? "test-fixtures/data/alpaca-etf-daily.json";
console.log(
  JSON.stringify(
    {
      researchOnly: true,
      selectionMetric: "training Sharpe ratio",
      ...runEtfMomentumWalkForward(await loadResearchCandles(path))
    },
    null,
    2
  )
);
