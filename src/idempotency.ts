import { createHash, randomUUID } from "node:crypto";

/** A fresh user operation; its transport retries reuse the returned key. */
export function operationIdempotencyKey(toolName: string, explicitKey?: string): string {
  return explicitKey || `mcp_${toolName}_${randomUUID()}`;
}

// A state change may legitimately recur after an intervening operation.
// A permanent hash of its arguments would replay the first response instead
// of applying A → B → A, or keep returning an expired deletion/check intent.
// Creation and send operations retain their deterministic duplicate protection.
const REPEATABLE_OPERATIONS = new Set([
  "set_domain_alias", "remove_domain_alias", "set_domain_mail_hosting",
  "retry_domain_dkim", "dns_recheck", "update_mailbox", "change_mailbox_password", "enable_imap",
  "set_mailboxes_drive_access", "suspend_mailbox_login", "resume_mailbox_login",
  "set_mailboxes_login_access", "pause_mailbox", "resume_mailbox",
  "set_forwarding", "set_auto_reply", "update_mail_rule", "upload_sieve_script",
  "create_delete_intent", "restore_mailbox", "add_shared_mailbox_member",
  "convert_mailbox_to_shared", "convert_shared_mailbox_to_regular",
  "update_identity", "set_reply_from_policy", "retry_migration", "cancel_migration",
  "test_migration_connection", "preview_bulk_migration", "drive_device_rotate",
  "set_domain_branding", "set_domain_brand_logo", "verify_domain_branding_dns",
  "remove_domain_brand_logo", "remove_domain_branding",
  "update_white_label_member", "suspend_white_label_member",
  "resume_white_label_member", "resend_white_label_invitation",
  "restore_white_label_member", "remove_white_label_member",
]);

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
 * Creation/send calls with the same params use the same key and deduplicate.
 * Repeatable state changes use a fresh operation key; the client's transport
 * retries retain that key. An explicit key always identifies a caller retry.
 * If an explicit key is provided by the caller, use that instead.
 */
export function idempotencyKey(
  toolName: string,
  params: Record<string, unknown>,
  explicitKey?: string,
): string {
  if (explicitKey) return explicitKey;
  if (REPEATABLE_OPERATIONS.has(toolName)) return operationIdempotencyKey(toolName);

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
