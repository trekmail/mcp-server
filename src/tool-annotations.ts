import type { ToolCatalogEntry } from "./tool-catalog.js";

// Additive operations do not overwrite or remove existing user data. Keep
// this independent of the environment safety switches: a sending gate is
// not permission to describe an irreversible send as non-destructive.
const ADDITIVE = new Set([
  "create_domain", "bulk_add_domains", "save_draft", "create_folder",
  "create_identity", "create_template", "create_contact", "create_contact_group",
  "create_calendar_event", "import_contacts", "add_contact_group_members",
  "create_mailbox_generated_password", "bulk_create_mailboxes", "create_shared_mailbox",
  "create_alias", "create_mail_rule", "create_domain_smtp_profile",
  "drive_folder_create", "drive_upload_initiate", "drive_upload_refresh_parts",
  "drive_file_upload", "drive_device_create", "create_branding_preview",
]);

const OPEN_WORLD = new Set([
  "agent_buy_verifier_credits", "agent_subscribe_mail_plan",
  "agent_subscribe_drive_addon", "agent_subscribe_white_label",
  "send_message", "schedule_message", "reschedule_message", "create_invite",
  "create_invites_bulk", "invite_white_label_member", "resend_white_label_invitation",
  "validate_cloudflare_token", "list_cloudflare_zones", "connect_cloudflare_domains",
  "preview_cloudflare_dns", "apply_cloudflare_dns", "dns_recheck",
  "verify_domain_branding_dns", "test_smtp", "test_domain_smtp",
  "test_migration_connection", "start_migration", "retry_migration",
  "preview_bulk_migration", "start_bulk_migration", "retry_bulk_migration",
  "resume_bulk_migration", "test_external_account", "test_saved_external_account",
  "detect_external_account", "verify_email", "verify_email_bulk",
  "create_ticket", "reply_to_ticket", "drive_share_create",
  // These settings can forward future mail or send vacation responses to
  // external recipients even though this call does not send immediately.
  "set_forwarding", "create_forwarding_address", "update_forwarding_address",
  "update_domain_catch_all", "create_mail_rule", "update_mail_rule",
  "reorder_mail_rules", "set_auto_reply", "upload_sieve_script",
  "set_domain_smtp", "set_account_smtp_default",
  // These operations can also target an independently hosted IMAP account.
  // Use the conservative hint for the complete tool, including its optional
  // external_account_id path; ownership and scope checks still apply.
  "list_messages", "read_message", "delete_message", "move_message",
  "list_folders", "update_message_flags", "download_attachment",
  "download_all_attachments", "get_raw_message", "save_draft", "update_draft",
  "bulk_action", "prepare_reply", "prepare_reply_all", "prepare_forward",
]);

export function toolAnnotations(
  entry: ToolCatalogEntry,
  original: Record<string, unknown> = {},
  title?: string,
): Record<string, unknown> & {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
} {
  return {
    ...original,
    // Directory reviewers read ToolAnnotations.title even when the tool
    // already supplies its display title at the top level.
    title: (typeof original.title === "string" ? original.title.trim() : "")
      || title?.trim()
      || entry.name.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    readOnlyHint: entry.access === "read",
    // Never erase an explicit warning from the implementation. Updates,
    // cancellation, credential issuance and external sends require review.
    destructiveHint: entry.access !== "read" && (
      original.destructiveHint === true || !ADDITIVE.has(entry.name)
    ),
    openWorldHint: OPEN_WORLD.has(entry.name) || original.openWorldHint === true,
  };
}
