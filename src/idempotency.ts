import { createHash } from "node:crypto";

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

  // Canonical JSON: sorted keys, no undefined values
  const canonical = JSON.stringify(params, Object.keys(params).sort());
  const hash = createHash("sha256")
    .update(`${toolName}:${canonical}`)
    .digest("hex")
    .slice(0, 32);
  return `mcp_${toolName}_${hash}`;
}
