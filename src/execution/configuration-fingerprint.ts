import { createHash } from "node:crypto";

export interface ConfigurationEvidence {
  fingerprint: string;
  effective: Record<string, unknown>;
}

export function buildConfigurationEvidence(
  effective: Record<string, unknown>
): ConfigurationEvidence {
  const canonical = canonicalize(effective);
  return {
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
    effective: JSON.parse(canonical) as Record<string, unknown>
  };
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
