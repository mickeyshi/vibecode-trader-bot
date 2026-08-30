export type StrategyParamValue = string | number | boolean;

export function parseStrategyParam(
  raw: string,
  label = "--strategy-param"
): Record<string, unknown> {
  const separator = raw.indexOf("=");
  if (separator <= 0) {
    throw new Error(`${label} must use key=value format.`);
  }

  const key = raw.slice(0, separator).trim();
  if (!key) {
    throw new Error(`${label} must include a parameter key.`);
  }

  return { [key]: parsePrimitive(raw.slice(separator + 1)) };
}

export function parseStrategyParams(rawValues: string[]): Record<string, unknown> {
  return rawValues.reduce(
    (params, raw) => ({
      ...params,
      ...parseStrategyParam(raw)
    }),
    {} as Record<string, unknown>
  );
}

function parsePrimitive(value: string): StrategyParamValue {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  const numberValue = Number(trimmed);
  return Number.isFinite(numberValue) && trimmed !== "" ? numberValue : value;
}
