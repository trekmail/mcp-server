/**
 * Canonical MCP exposure catalog.
 *
 * Tool implementations remain in src/tools/*.ts. This file owns the stable
 * product grouping used to build a small tools/list without cloning handlers
 * for Dashboard, Webmail, Account Drive, or Mailbox Drive.
 *
 * This catalog is also the single source of truth for registration-time
 * authorization. Dashboard and Webmail are product surfaces, not separate
 * MCP namespaces: their tools point at the same REST/message capabilities.
 */

export const TOOLSETS = [
  "core",
  "email",
  "email_settings",
  "contacts",
  "calendar",
  "drive",
  "domains",
  "mail_admin",
  "delivery",
  "migrations",
  "support",
  "verifier",
  "credentials",
] as const;

export type Toolset = (typeof TOOLSETS)[number];
export type ToolTransport = "stdio" | "http";
export type ToolAccess = "read" | "write" | "destructive";
export type ToolSafetyGate = "destructive" | "sending" | "migration";

export interface ToolCatalogEntry {
  name: string;
  toolset: Toolset;
  transports: readonly ToolTransport[];
  /** At least one capability is required. The upstream API remains authoritative. */
  anyOfCapabilities: readonly string[];
  access: ToolAccess;
  safetyGate?: ToolSafetyGate;
}

const BOTH_TRANSPORTS = ["stdio", "http"] as const;
const STDIO_ONLY = ["stdio"] as const;

const NAMES_BY_TOOLSET: Readonly<Record<Toolset, readonly string[]>> = {
  core: [
    "whoami",
    "get_account",
    "get_billing_status",
    "list_invoices",
  ],

  email: [
    "list_messages",
    "read_message",
    "send_message",
    "delete_message",
    "move_message",
    "list_folders",
    "update_message_flags",
    "download_attachment",
    "download_all_attachments",
    "get_raw_message",
    "save_draft",
    "update_draft",
    "report_spam",
    "report_ham",
    "bulk_action",
    "prepare_reply",
    "prepare_reply_all",
    "prepare_forward",
  ],

  email_settings: [
    "create_folder",
    "rename_folder",
    "delete_folder",
    "empty_folder",
    "schedule_message",
    "list_scheduled",
    "reschedule_message",
    "cancel_scheduled",
    "list_identities",
    "create_identity",
    "update_identity",
    "delete_identity",
    "list_templates",
    "create_template",
    "update_template",
    "delete_template",
    "list_blocked_senders",
    "block_sender",
    "unblock_sender",
    "list_external_accounts",
    "detect_external_account",
    "test_external_account",
    "create_external_account",
    "update_external_account",
    "test_saved_external_account",
    "delete_external_account",
  ],

  contacts: [
    "list_contacts",
    "create_contact",
    "update_contact",
    "delete_contact",
    "import_contacts",
    "export_contacts",
    "list_contact_groups",
    "list_contact_group_members",
    "create_contact_group",
    "update_contact_group",
    "delete_contact_group",
    "add_contact_group_members",
    "remove_contact_group_members",
  ],

  calendar: [
    "list_calendar_events",
    "create_calendar_event",
    "update_calendar_event",
    "delete_calendar_event",
  ],

  drive: [
    "drive_spaces_list",
    "drive_storage_summary",
    "drive_space_usage",
    "drive_browse_folder",
    "drive_folder_tree",
    "drive_select_all_ids",
    "drive_file_get",
    "drive_file_download_url",
    "drive_file_rename",
    "drive_file_move",
    "drive_file_trash",
    "drive_file_restore",
    "drive_file_purge",
    "drive_folder_create",
    "drive_folder_update",
    "drive_folder_move",
    "drive_folder_trash",
    "drive_folder_restore",
    "drive_folder_purge",
    "drive_folder_share_with_account",
    "drive_folder_stop_sharing",
    "drive_trash_list",
    "drive_trash_empty",
    "drive_bulk_trash",
    "drive_bulk_restore",
    "drive_bulk_move",
    "drive_bulk_purge",
    "drive_share_create",
    "drive_share_list",
    "drive_share_revoke",
    "drive_upload_initiate",
    "drive_upload_complete",
    "drive_upload_refresh_parts",
    "drive_upload_abort",
    "drive_addon_get",
    "drive_addon_pricing",
    "drive_addon_cancellation_preview",
    "drive_file_upload",
  ],

  domains: [
    "list_domains",
    "get_domain",
    "create_domain",
    "delete_domain",
    "update_domain_catch_all",
    "retry_domain_dkim",
    "update_domain_note",
    "get_domain_signature",
    "update_domain_signature",
    "bulk_add_domains",
    "get_dns_requirements",
    "dns_recheck",
    "get_dns_check",
    "get_domain_branding",
    "set_domain_branding",
    "set_domain_brand_logo",
    "verify_domain_branding_dns",
    "create_branding_preview",
    "remove_domain_brand_logo",
    "remove_domain_branding",
    "validate_cloudflare_token",
    "list_cloudflare_zones",
    "connect_cloudflare_domains",
    "preview_cloudflare_dns",
    "apply_cloudflare_dns",
    "list_cloudflare_tokens",
    "delete_cloudflare_token",
  ],

  mail_admin: [
    "list_mailboxes",
    "get_mailbox",
    "create_mailbox_generated_password",
    "change_mailbox_password",
    "update_mailbox",
    "update_mailbox_note",
    "pause_mailbox",
    "resume_mailbox",
    "bulk_create_mailboxes",
    "enable_imap",
    "get_mail_client_setup",
    "get_apple_mail_profile",
    "create_invite",
    "create_invites_bulk",
    "list_aliases",
    "create_alias",
    "update_alias",
    "delete_alias",
    "list_shared_mailbox_members",
    "add_shared_mailbox_member",
    "update_shared_mailbox_member",
    "remove_shared_mailbox_member",
    "create_shared_mailbox",
    "convert_mailbox_to_shared",
    "convert_shared_mailbox_to_regular",
    "get_forwarding",
    "set_forwarding",
    "list_mail_rules",
    "get_mail_rule",
    "create_mail_rule",
    "update_mail_rule",
    "delete_mail_rule",
    "reorder_mail_rules",
    "get_auto_reply",
    "set_auto_reply",
    "get_sieve_script",
    "upload_sieve_script",
    "create_delete_intent",
    "confirm_delete_intent",
    "restore_mailbox",
    "list_trashed_mailboxes",
  ],

  delivery: [
    "get_smtp_config",
    "update_smtp_config",
    "delete_smtp_connection",
    "test_smtp",
    "get_smtp_test_status",
    "get_domain_smtp",
    "set_domain_smtp",
    "get_account_smtp_default",
    "set_account_smtp_default",
    "list_domain_smtp_profiles",
    "create_domain_smtp_profile",
    "update_domain_smtp_profile",
    "delete_domain_smtp_profile",
    "test_domain_smtp",
    "get_domain_smtp_test_status",
    "get_spam_metrics",
    "get_spam_summary",
    "get_domain_deliverability",
    "list_domain_bounces",
    "list_mailbox_bounces",
  ],

  migrations: [
    "test_migration_connection",
    "list_migrations",
    "get_migration",
    "start_migration",
    "cancel_migration",
    "retry_migration",
    "delete_migration",
    "preview_bulk_migration",
    "start_bulk_migration",
    "list_bulk_migrations",
    "get_bulk_migration",
    "cancel_bulk_migration",
    "retry_bulk_migration",
    "delete_bulk_migration",
    "update_bulk_migration_job_password",
    "resume_bulk_migration",
  ],

  support: [
    "list_tickets",
    "get_ticket",
    "get_ticket_messages",
    "create_ticket",
    "reply_to_ticket",
    "close_ticket",
  ],

  verifier: [
    "verify_email",
    "verify_email_bulk",
    "verify_job_status",
    "verify_credits",
    "verify_list_jobs",
    "verify_cancel_job",
    "verify_delete_job",
    "verify_job_download",
  ],

  credentials: [
    "create_message_token",
    "list_message_tokens",
    "revoke_message_token",
    "drive_device_list",
    "drive_device_create",
    "drive_device_revoke",
    "drive_device_rotate",
  ],
};

interface PolicyRule {
  names: readonly string[];
  anyOfCapabilities: readonly string[];
  access: ToolAccess;
}

const rule = (
  capability: string | readonly string[],
  access: ToolAccess,
  names: readonly string[],
): PolicyRule => ({
  names,
  anyOfCapabilities: typeof capability === "string" ? [capability] : capability,
  access,
});

const DRIVE_READ = ["drive:account:read", "drive:mailbox:read"] as const;
const DRIVE_WRITE = ["drive:account:write", "drive:mailbox:write"] as const;
const DRIVE_SHARE = ["drive:account:share", "drive:mailbox:share"] as const;
const DRIVE_PURGE = ["drive:account:purge", "drive:mailbox:purge"] as const;

/**
 * Exact capability contract for every registered tool. Arrays mean any-of,
 * which is necessary for generic Drive tools whose concrete account/mailbox
 * space is authorised again by Laravel after the call is made.
 */
const POLICY_RULES: readonly PolicyRule[] = [
  rule("account:read", "read", ["whoami", "get_account"]),
  rule("billing:read", "read", ["get_billing_status", "list_invoices"]),

  rule("messages:read", "read", [
    "list_messages", "read_message", "list_folders", "download_attachment",
    "download_all_attachments", "get_raw_message", "prepare_reply",
    "prepare_reply_all", "prepare_forward", "list_scheduled", "list_identities",
    "list_templates", "list_blocked_senders", "list_external_accounts",
    "detect_external_account", "list_contacts", "export_contacts",
    "list_contact_groups", "list_contact_group_members", "list_calendar_events",
  ]),
  rule("messages:send", "write", [
    "send_message", "schedule_message", "reschedule_message",
  ]),
  rule("messages:send", "destructive", ["cancel_scheduled"]),
  rule("messages:write", "write", [
    "move_message", "update_message_flags",
    "save_draft", "update_draft", "report_spam", "report_ham", "bulk_action",
    "create_folder", "rename_folder", "create_identity", "update_identity", "create_template",
    "update_template", "block_sender", "unblock_sender", "test_external_account",
    "create_external_account", "update_external_account", "test_saved_external_account",
    "create_contact", "update_contact", "import_contacts", "create_contact_group",
    "update_contact_group", "add_contact_group_members", "remove_contact_group_members",
    "create_calendar_event", "update_calendar_event",
  ]),
  rule("messages:write", "destructive", [
    "delete_message", "empty_folder", "delete_folder", "delete_identity",
    "delete_template", "delete_external_account", "delete_contact",
    "delete_contact_group", "delete_calendar_event",
  ]),

  rule("domains:read", "read", [
    "list_domains", "get_domain", "get_domain_signature", "get_domain_branding",
  ]),
  rule("domains:create", "write", ["create_domain", "bulk_add_domains"]),
  rule("domains:write", "write", [
    "update_domain_catch_all", "retry_domain_dkim", "update_domain_note",
    "update_domain_signature", "set_domain_branding", "set_domain_brand_logo",
    "verify_domain_branding_dns", "create_branding_preview",
    "remove_domain_brand_logo", "remove_domain_branding",
  ]),
  rule("domains:delete", "destructive", ["delete_domain"]),
  rule("domains:dns:read", "read", ["get_dns_requirements", "get_dns_check"]),
  rule("domains:dns:recheck", "write", ["dns_recheck"]),
  rule("cloudflare:read", "read", [
    "validate_cloudflare_token", "list_cloudflare_zones", "preview_cloudflare_dns",
    "list_cloudflare_tokens",
  ]),
  rule("cloudflare:write", "write", ["connect_cloudflare_domains", "apply_cloudflare_dns"]),
  rule("cloudflare:delete", "destructive", ["delete_cloudflare_token"]),

  rule("mailboxes:read", "read", [
    "list_mailboxes", "get_mailbox", "get_mail_client_setup", "get_apple_mail_profile",
    "list_aliases", "list_shared_mailbox_members", "list_trashed_mailboxes",
    "list_mailbox_bounces",
  ]),
  rule("mailboxes:create", "write", [
    "create_mailbox_generated_password", "bulk_create_mailboxes", "create_shared_mailbox",
  ]),
  rule("mailboxes:write", "write", [
    "change_mailbox_password", "update_mailbox", "update_mailbox_note", "pause_mailbox",
    "resume_mailbox", "enable_imap", "create_alias", "update_alias",
    "add_shared_mailbox_member", "update_shared_mailbox_member", "remove_shared_mailbox_member",
    "convert_mailbox_to_shared", "convert_shared_mailbox_to_regular",
  ]),
  rule("mailboxes:write", "destructive", ["delete_alias"]),
  rule("mailboxes:invites:create", "write", ["create_invite", "create_invites_bulk"]),
  rule("mailboxes:forwarding:read", "read", ["get_forwarding"]),
  rule("mailboxes:forwarding:write", "write", ["set_forwarding"]),
  rule("mailboxes:rules:read", "read", ["list_mail_rules", "get_mail_rule", "get_sieve_script"]),
  rule("mailboxes:rules:write", "write", [
    "create_mail_rule", "update_mail_rule", "reorder_mail_rules", "upload_sieve_script",
  ]),
  rule("mailboxes:rules:write", "destructive", ["delete_mail_rule"]),
  rule("mailboxes:auto-reply:read", "read", ["get_auto_reply"]),
  rule("mailboxes:auto-reply:write", "write", ["set_auto_reply"]),
  rule("mailboxes:delete", "destructive", [
    "create_delete_intent", "confirm_delete_intent", "restore_mailbox",
  ]),
  rule("mailboxes:message-tokens:manage", "read", ["list_message_tokens"]),
  rule("mailboxes:message-tokens:manage", "write", ["create_message_token"]),
  rule("mailboxes:message-tokens:manage", "destructive", ["revoke_message_token"]),

  rule("migrations:read", "read", [
    "list_migrations", "get_migration", "list_bulk_migrations", "get_bulk_migration",
  ]),
  rule("migrations:write", "write", [
    "test_migration_connection", "start_migration", "cancel_migration", "retry_migration",
    "preview_bulk_migration", "start_bulk_migration", "cancel_bulk_migration",
    "retry_bulk_migration", "update_bulk_migration_job_password", "resume_bulk_migration",
  ]),
  rule("migrations:write", "destructive", ["delete_migration", "delete_bulk_migration"]),
  rule("tickets:read", "read", ["list_tickets", "get_ticket", "get_ticket_messages"]),
  rule("tickets:write", "write", ["create_ticket", "reply_to_ticket", "close_ticket"]),

  rule("smtp:read", "read", [
    "get_smtp_config", "get_smtp_test_status", "get_domain_smtp",
    "get_account_smtp_default", "list_domain_smtp_profiles", "get_domain_smtp_test_status",
  ]),
  rule("smtp:write", "write", [
    "update_smtp_config", "test_smtp", "set_domain_smtp", "set_account_smtp_default",
    "create_domain_smtp_profile", "update_domain_smtp_profile", "test_domain_smtp",
  ]),
  rule("smtp:write", "destructive", ["delete_smtp_connection", "delete_domain_smtp_profile"]),
  rule("domains:read", "read", [
    "get_spam_metrics", "get_spam_summary", "get_domain_deliverability", "list_domain_bounces",
  ]),
  rule("verify:read", "read", [
    "verify_job_status", "verify_credits", "verify_list_jobs", "verify_job_download",
  ]),
  rule("verify:write", "write", ["verify_email", "verify_email_bulk", "verify_cancel_job"]),
  rule("verify:write", "destructive", ["verify_delete_job"]),

  rule(DRIVE_READ, "read", [
    "drive_spaces_list", "drive_storage_summary", "drive_space_usage", "drive_browse_folder",
    "drive_folder_tree", "drive_select_all_ids", "drive_file_get", "drive_file_download_url",
    "drive_trash_list",
  ]),
  rule(DRIVE_WRITE, "write", [
    "drive_file_rename", "drive_file_move", "drive_file_trash", "drive_file_restore",
    "drive_folder_create", "drive_folder_update", "drive_folder_move", "drive_folder_trash",
    "drive_folder_restore", "drive_folder_share_with_account", "drive_folder_stop_sharing",
    "drive_bulk_trash", "drive_bulk_restore", "drive_bulk_move", "drive_upload_initiate",
    "drive_upload_complete", "drive_upload_refresh_parts", "drive_upload_abort", "drive_file_upload",
  ]),
  rule(DRIVE_SHARE, "read", ["drive_share_list"]),
  rule(DRIVE_SHARE, "write", ["drive_share_create"]),
  rule(DRIVE_SHARE, "destructive", ["drive_share_revoke"]),
  rule(DRIVE_PURGE, "destructive", [
    "drive_file_purge", "drive_folder_purge", "drive_trash_empty", "drive_bulk_purge",
  ]),
  rule("drive:addon:read", "read", [
    "drive_addon_get", "drive_addon_pricing", "drive_addon_cancellation_preview",
  ]),
  rule("drive:devices:read", "read", ["drive_device_list"]),
  rule("drive:devices:write", "write", ["drive_device_create", "drive_device_rotate"]),
  rule("drive:devices:write", "destructive", ["drive_device_revoke"]),
];

const policyByName = new Map<string, Omit<PolicyRule, "names">>();
for (const policy of POLICY_RULES) {
  for (const name of policy.names) {
    if (policyByName.has(name)) {
      throw new Error(`Duplicate MCP tool policy entry: ${name}`);
    }
    policyByName.set(name, {
      anyOfCapabilities: policy.anyOfCapabilities,
      access: policy.access,
    });
  }
}

const SENDING_GATED = new Set([
  "send_message",
  "schedule_message",
  "reschedule_message",
  "create_invite",
  "create_invites_bulk",
]);
const MIGRATION_GATED = new Set([
  "test_migration_connection",
  "start_migration",
  "retry_migration",
  "delete_migration",
  "preview_bulk_migration",
  "start_bulk_migration",
  "retry_bulk_migration",
  "delete_bulk_migration",
  "update_bulk_migration_job_password",
  "test_external_account",
  "test_saved_external_account",
]);
const UNGATED_MUTATIONS = new Set([
  // These are safety/abort operations or perform their own conditional gate.
  "cancel_migration",
  "cancel_bulk_migration",
  "resume_bulk_migration",
  "create_message_token",
]);

function safetyGateFor(name: string, access: ToolAccess): ToolSafetyGate | undefined {
  if (SENDING_GATED.has(name)) return "sending";
  if (MIGRATION_GATED.has(name)) return "migration";
  if (access !== "read" && !UNGATED_MUTATIONS.has(name)) return "destructive";
  return undefined;
}

const entries: ToolCatalogEntry[] = [];
const seen = new Set<string>();

for (const toolset of TOOLSETS) {
  for (const name of NAMES_BY_TOOLSET[toolset]) {
    if (seen.has(name)) {
      throw new Error(`Duplicate MCP tool catalog entry: ${name}`);
    }
    seen.add(name);
    const policy = policyByName.get(name);
    if (!policy) {
      throw new Error(`Missing MCP tool policy entry: ${name}`);
    }
    entries.push({
      name,
      toolset,
      transports: name === "drive_file_upload" ? STDIO_ONLY : BOTH_TRANSPORTS,
      ...policy,
      safetyGate: safetyGateFor(name, policy.access),
    });
  }
}

for (const name of policyByName.keys()) {
  if (!seen.has(name)) {
    throw new Error(`Policy exists for unknown MCP tool: ${name}`);
  }
}

export const TOOL_CATALOG: readonly ToolCatalogEntry[] = Object.freeze(entries);

/** Bump whenever grouping/capability/safety semantics change. */
export const TOOL_CATALOG_VERSION = "2026-07-22.2";

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export const TOOL_CATALOG_HASH = fnv1a(JSON.stringify(
  TOOL_CATALOG.map((entry) => ({
    name: entry.name,
    toolset: entry.toolset,
    transports: entry.transports,
    anyOfCapabilities: [...entry.anyOfCapabilities].sort(),
    access: entry.access,
    safetyGate: entry.safetyGate ?? null,
  })),
));

export const TOOL_CATALOG_BY_NAME: ReadonlyMap<string, ToolCatalogEntry> =
  new Map(TOOL_CATALOG.map((entry) => [entry.name, entry]));

const REQUIRED_TOOLS_BY_TOOLSET: Readonly<Partial<Record<Toolset, readonly string[]>>> = {
  email: ["list_mailboxes"],
  email_settings: ["list_mailboxes"],
  contacts: ["list_mailboxes"],
  calendar: ["list_mailboxes"],
};

export function catalogEntryForTool(name: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG_BY_NAME.get(name);
}

export function toolsForToolsets(toolsets: readonly Toolset[]): ReadonlySet<string> {
  const selected = new Set<Toolset>(toolsets);
  const names = new Set(
    TOOL_CATALOG
      .filter((entry) => selected.has(entry.toolset))
      .map((entry) => entry.name),
  );
  for (const toolset of selected) {
    for (const dependency of REQUIRED_TOOLS_BY_TOOLSET[toolset] ?? []) {
      names.add(dependency);
    }
  }
  return names;
}

export function hasCapabilityForTool(
  name: string,
  capabilities: readonly string[],
): boolean {
  const entry = catalogEntryForTool(name);
  if (!entry) return false;
  const granted = new Set(capabilities);
  return entry.anyOfCapabilities.some((capability) => granted.has(capability));
}
