import { runPaperDeploymentPreflight } from "./paper-deployment-preflight.js";

const result = await runPaperDeploymentPreflight();
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
