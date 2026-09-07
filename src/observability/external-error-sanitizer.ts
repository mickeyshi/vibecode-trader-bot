const SECRET_PATTERN =
  /(api[-_ ]?key|secret|token|authorization|account[-_ ]?id)\s*[=:]\s*[^\s,;]+/gi;

export function sanitizedExternalErrorDetail(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "No response detail.";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const safe: Record<string, unknown> = {};
      if (typeof record.code === "number" || typeof record.code === "string")
        safe.code = record.code;
      if (typeof record.message === "string") safe.message = redact(record.message);
      if (Object.keys(safe).length > 0) return JSON.stringify(safe).slice(0, 500);
    }
  } catch {
    // Fall through to a redacted, bounded text detail.
  }
  return redact(trimmed).slice(0, 500);
}

function redact(value: string): string {
  return value.replace(SECRET_PATTERN, "$1=[REDACTED]");
}
