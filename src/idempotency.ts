import { createHash, randomUUID } from "node:crypto";

/** A fresh user operation; its transport retries reuse the returned key. */
export function operationIdempotencyKey(toolName: string, explicitKey?: string): string {
  return explicitKey || `mcp_${toolName}_${randomUUID()}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(value).sort()) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested !== undefined) {
        result[key] = canonicalize(nested);
      }
    }

    return result;
  }

  return value;
}

/**
 * Generate a deterministic idempotency key from tool name + canonical params.
 * Same tool call with same params → same key → API deduplicates.
 * If an explicit key is provided by the caller, use that instead.
 */
export function idempotencyKey(
  toolName: string,
  params: Record<string, unknown>,
  explicitKey?: string,
): string {
  if (explicitKey) return explicitKey;

  // Canonical JSON: keys are sorted at every depth and undefined object
  // properties are omitted. A JSON.stringify replacer-array looks similar but
  // applies its key allow-list to nested objects too, silently erasing fields
  // that do not also exist at the top level.
  const canonical = JSON.stringify(canonicalize(params));
  const hash = createHash("sha256")
    .update(`${toolName}:${canonical}`)
    .digest("hex")
    .slice(0, 32);
  return `mcp_${toolName}_${hash}`;
}
