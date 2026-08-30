import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  renderAdvancedStrategyValidation,
  runAdvancedStrategyValidation
} from "./advanced-strategy-validation.js";

const outputPath = process.argv[2] ?? "reports/advanced-strategy-validation.md";
const result = await runAdvancedStrategyValidation();
const report = renderAdvancedStrategyValidation(result);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, report, "utf8");
console.log(`Wrote ${outputPath}`);
