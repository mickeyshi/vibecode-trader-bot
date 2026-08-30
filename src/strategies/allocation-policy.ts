import { parseSymbolList } from "../feeds/alpaca-iex-config.js";

export interface AllocationPolicy {
  targetAllocationPctBySymbol: Record<string, number>;
  totalAllocationPct: number;
}

export function buildAllocationPolicy(input: {
  symbols: string[];
  defaultTargetAllocationPct: number;
  allocationWeights?: string;
  maxTotalAllocationPct: number;
}): AllocationPolicy {
  const symbols = parseSymbolList(input.symbols.join(","));
  const explicitTargets = input.allocationWeights
    ? parseAllocationWeights(input.allocationWeights)
    : {};
  const targetAllocationPctBySymbol: Record<string, number> = {};

  for (const symbol of symbols) {
    targetAllocationPctBySymbol[symbol] =
      explicitTargets[symbol] ?? input.defaultTargetAllocationPct;
  }

  const unknownSymbols = Object.keys(explicitTargets).filter((symbol) => !symbols.includes(symbol));
  if (unknownSymbols.length > 0) {
    throw new Error(
      `Allocation weights include symbols not in --symbols: ${unknownSymbols.join(", ")}`
    );
  }

  const totalAllocationPct = Object.values(targetAllocationPctBySymbol).reduce(
    (sum, allocation) => sum + allocation,
    0
  );
  if (totalAllocationPct > input.maxTotalAllocationPct) {
    throw new Error(
      `Total allocation ${(totalAllocationPct * 100).toFixed(2)}% exceeds max total allocation ${(input.maxTotalAllocationPct * 100).toFixed(2)}%.`
    );
  }

  return {
    targetAllocationPctBySymbol,
    totalAllocationPct
  };
}

export function parseAllocationWeights(raw: string): Record<string, number> {
  const allocations: Record<string, number> = {};

  for (const entry of raw.split(",")) {
    const [rawSymbol, rawAllocation, ...extra] = entry.split("=");
    if (!rawSymbol || !rawAllocation || extra.length > 0) {
      throw new Error("Allocation weights must use SYMBOL=decimal pairs separated by commas.");
    }

    const symbol = rawSymbol.trim().toUpperCase();
    const allocation = Number(rawAllocation.trim());
    if (!symbol) {
      throw new Error("Allocation weight symbol must be non-empty.");
    }

    if (!Number.isFinite(allocation) || allocation <= 0 || allocation > 1) {
      throw new Error(
        "Allocation weight values must be greater than 0 and less than or equal to 1."
      );
    }

    allocations[symbol] = allocation;
  }

  if (Object.keys(allocations).length === 0) {
    throw new Error("At least one allocation weight is required.");
  }

  return allocations;
}
