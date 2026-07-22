# TrekMail MCP Server

A Model Context Protocol (MCP) server that exposes the TrekMail API v1 as 228 agent tools. This is a thin adapter — all business logic lives in the TrekMail API; this server handles transport, authentication, retries, and safety gates.

## What's new in 1.8.0

- Agents can read and update a regular mailbox's Webmail `conversation_view` preference through `list_mailboxes`, `get_mailbox`, and `update_mailbox`.
- Mail-client setup now describes delegated shared-mailbox readiness, effective Send As access, exact special-folder paths, supported operations, and Sent-copy ownership.
- Shared-mailbox lifecycle schemas now match the API contract: a display name is required, direct-login semantics are explicit, and retryable native-access sync failures are documented.
- Folder deletion is documented as leaf-only so an agent cannot assume that deleting a parent recursively removes its subtree.

## Quickstart

### npm

```bash
git clone https://github.com/trekmail/mcp-server trekmail-mcp
cd trekmail-mcp
npm install
npm run build

TREKMAIL_BASE_URL=https://trekmail.net \
TREKMAIL_API_TOKEN=tm_live_your_token \
npm start
```

### Docker

```bash
git clone https://github.com/trekmail/mcp-server trekmail-mcp
cd trekmail-mcp
docker build -t trekmail-mcp .

docker run -i \
  -e TREKMAIL_BASE_URL=https://trekmail.net \
  -e TREKMAIL_API_TOKEN=tm_live_your_token \
  trekmail-mcp
```

## Dual-Token Architecture

The MCP server supports two independent token types. At least one is required:

| Token | Env Var | Prefix | Unlocks |
|-------|---------|--------|---------|
| **Ops token** | `TREKMAIL_API_TOKEN` | `tm_live_` | 167 infrastructure tools (domains, DNS, mailboxes, mail-client setup, invites, aliases, shared mailbox members, forwarding, mail filters, auto-reply, sieve, delete intents, migrations, SMTP, tickets, account, billing, spam stats, verifier, message token management, Cloudflare DNS, Drive, and Drive sync-device passwords) |
| **Message token** | `TREKMAIL_MESSAGE_TOKEN` | `tm_msg_` | 61 message tools (messages, attachments, drafts, bulk actions, folders, scheduled send, contacts, contact groups, calendar, compose helpers, connected accounts, identities, templates, blocked senders) |

Tools are registered conditionally — only token types you provide get their tools. You can supply one or both:

```bash
# Infrastructure only
TREKMAIL_API_TOKEN=tm_live_your_token npm start

# Messages only
TREKMAIL_MESSAGE_TOKEN=tm_msg_your_token npm start

# Both
TREKMAIL_API_TOKEN=tm_live_your_token \
TREKMAIL_MESSAGE_TOKEN=tm_msg_your_token \
npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TREKMAIL_BASE_URL` | Yes | — | Your TrekMail instance URL |
| `TREKMAIL_API_TOKEN` | At least one token | — | Ops token (must start with `tm_live_`) |
| `TREKMAIL_MESSAGE_TOKEN` | At least one token | — | Message token (must start with `tm_msg_`) |
| `TREKMAIL_TIMEOUT_MS` | No | `30000` | Request timeout in milliseconds |
| `TREKMAIL_USER_AGENT` | No | `trekmail-mcp/1.8.0` | User-Agent header |
| `TREKMAIL_ALLOW_DESTRUCTIVE` | No | `false` | Enable destructive tools (delete intents, domain delete, password change, pause, SMTP config, revoke token, delete Cloudflare token, Drive trash/purge/empty-trash, Drive sync-device revoke/rotate, message deletes) |
| `TREKMAIL_ALLOW_SENDING` | No | `false` | Enable `send_message` tool |
| `TREKMAIL_ALLOW_MIGRATION` | No | `false` | Enable migration write tools (`start_migration`, `retry_migration`, `delete_migration`, `delete_bulk_migration`, `update_bulk_migration_job_password`, `test_migration_connection`) |
| `TREKMAIL_TOOLSETS` | No | all | Comma-separated product sets to register, for example `email` or `email,contacts,calendar` |
| `TREKMAIL_SCOPE_AWARE_REGISTRATION` | No | `true` | Discover the token's effective capabilities at startup and omit unusable tool schemas; set `false` only as a compatibility escape hatch |
| `TREKMAIL_READ_ONLY` | No | `false` | Register read tools only, even when the token can write |

Tool visibility is the intersection of token capability, `TREKMAIL_TOOLSETS`,
`TREKMAIL_READ_ONLY`, safety flags, and transport support. Runtime API
authorization remains authoritative. Account Drive and Mailbox Drive share one
`drive` toolset; the concrete space and token constraints decide what a call can
access. Compact email, contacts, calendar, and email-settings selections also
include the read-only `list_mailboxes` tool so an agent can discover the required
mailbox ID without loading the full administration toolset.

For a normal mailbox project, this compact configuration exposes only the
email tools allowed by that token:

```bash
TREKMAIL_MESSAGE_TOKEN=tm_msg_your_token \
TREKMAIL_TOOLSETS=email \
TREKMAIL_SCOPE_AWARE_REGISTRATION=true \
npm start
```

## Tools (228)

> The full catalog is **228** tools over stdio. On the hosted **HTTP** transport
> `drive_file_upload` is intentionally not registered (its `local_path` would read
> files on our server — see the note in `src/tools/drive.ts`), so the HTTP MCP
> exposes 227. Tools also split by token type: **61** need a message token
> (`tm_msg_`), the rest an ops token (`tm_live_`).

### Domains (ops token)
- **list_domains** — List domains with optional status/search filters
- **get_domain** — Get details for a specific domain
- **create_domain** — Add a new domain to the account
- **delete_domain** — Delete a domain (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **update_domain_catch_all** — Configure or clear the catch-all address
- **retry_domain_dkim** — Retry DKIM key provisioning
- **update_domain_note** — Update the admin note on a domain
- **get_domain_signature** — Read per-domain email signature settings (mode, position, HTML)
- **update_domain_signature** — Set per-domain signature (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **bulk_add_domains** — Add up to 20 domains in one call

### DNS (ops token)
- **get_dns_requirements** — Get required DNS records for a domain
- **dns_recheck** — Trigger async DNS verification (returns check ID)
- **get_dns_check** — Poll DNS check status/results

### Mailboxes (ops token)
- **list_mailboxes** — List mailboxes with optional domain/search filters
- **get_mailbox** — Get details for a specific mailbox
- **get_mail_client_setup** — Get password-free IMAP/SMTP settings, actual sending readiness, localized guides for five app families, and delegated shared-mailbox folders for a regular member mailbox
- **get_apple_mail_profile** — Generate a password-free Apple Mail `.mobileconfig` file as Base64 (13 locales)
- **create_mailbox_generated_password** — Create mailbox with auto-generated one-time password (optional `storage_allocation_mb` carves out dedicated storage from the account pool; omit for shared)
- **change_mailbox_password** — Change the password for a mailbox (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **update_mailbox** — Update a mailbox display name or a regular mailbox's webmail `conversation_view` preference (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **update_mailbox_note** — Update the admin note on a mailbox
- **pause_mailbox** — Disable a mailbox (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **resume_mailbox** — Re-enable a paused mailbox
- **enable_imap** — Enable IMAP access for a mailbox (required for Message API)
- **bulk_create_mailboxes** — Create 1-100 mailboxes at once with per-item `storage_allocation_mb` (sum across the batch is validated against the available pool)

### Invites (ops token)
- **create_invite** — Send a setup invite to a recipient (optional `storage_allocation_mb` pre-allocates dedicated storage; the recipient inherits it at redeem)
- **create_invites_bulk** — Send up to 100 setup invites in one call (per-item `storage_allocation_mb` supported)

### Aliases (ops token)
- **list_aliases** — List all aliases for a mailbox (includes primary address and plan limits)
- **create_alias** — Add an alias to a mailbox (cross-domain supported, Starter+ plans)
- **update_alias** — Toggle receiving, sending, or active/inactive status
- **delete_alias** — Permanently remove an alias (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)

### Shared Mailbox Members (ops token)
- **list_shared_mailbox_members** — List members and their flat `can_read` / `can_send` permissions; membership grants Webmail and, when enabled, delegated native IMAP access
- **add_shared_mailbox_member** — Add an existing regular mailbox; `can_send` defaults to true (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **update_shared_mailbox_member** — Toggle send-as permission or set the member's personal Webmail label; retryable native-sync failures preserve the old permission (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **remove_shared_mailbox_member** — Revoke Webmail/native access without deleting the member mailbox; the last member cannot be removed (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)

Shared mailboxes never authenticate directly. Call **get_mail_client_setup** with a regular member mailbox id, wait for `native_access_ready=true` and (for sending) `send_as_ready=true`, then inspect `shared_mailboxes.items[]` for exact Inbox/Sent/Archive/Junk paths and allowed operations. SMTP does not save a Sent copy; configure the client to append it to the returned shared Sent folder.

### Shared Mailbox Lifecycle (ops token)
- **create_shared_mailbox** — Create a shared mailbox with a required display name and one or more regular member mailbox ids (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **convert_mailbox_to_shared** — Rotate a regular mailbox's credential, disable direct login, and assign members (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **convert_shared_mailbox_to_regular** — Revoke every member's Webmail/native access and set a fresh direct-login password; a retryable native-sync failure leaves it shared (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)

### Forwarding (ops token)
- **get_forwarding** — Read the current forwarding config for a mailbox. Returns the `targets` array (one or more destinations), `keep_copy`, and `destination_limit` (the plan-tier cap so the agent can preflight an `set_forwarding` call without trial-and-error).
- **set_forwarding** — Configure one or more forwarding destinations for a mailbox, plus enable/disable and keep-copy. The `targets` array accepts up to 30 entries client-side; the server enforces the actual per-plan cap — Starter **5**, Pro **15**, Agency **30** — and returns a 422 `limit_exceeded` error with the cap if you pass more. CRLF / loop / self-forward / MX validation is run per destination, so a single bad entry rejects the whole save.

### Mail Filters (ops token)
- **list_mail_rules** — List all mail filters for a mailbox
- **get_mail_rule** — Get a single mail filter by ID
- **create_mail_rule** — Create a new filter with conditions and actions
- **update_mail_rule** — Update an existing filter
- **delete_mail_rule** — Delete a filter (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)
- **reorder_mail_rules** — Change filter execution order

### Auto-Reply (ops token)
- **get_auto_reply** — Get vacation auto-reply settings for a mailbox
- **set_auto_reply** — Configure auto-reply subject, message, dates, and list skipping

### Sieve (ops token)
- **get_sieve_script** — Get the raw Sieve script for a mailbox
- **upload_sieve_script** — Upload a raw Sieve script for a mailbox

### Delete Intents (ops token, two-step)
- **create_delete_intent** — Step 1: create a time-limited delete intent
- **confirm_delete_intent** — Step 2: confirm and execute deletion (irreversible)

### Messages (message token)

> Many message tools accept an optional **`external_account_id`** to operate on a
> connected external mailbox (Gmail/Outlook/IMAP) instead of the primary mailbox.
> The id is always scoped to the token's mailbox (cross-mailbox access is
> impossible); discover valid ids with `list_external_accounts`. Supported on:
> `list_messages`, `read_message`, `send_message`, `move_message`,
> `update_message_flags`, `delete_message`, `list_folders`, `download_attachment`,
> `download_all_attachments`, `get_raw_message`, `save_draft`, `update_draft`, and
> `bulk_action` (native actions only: read/unread/star/unstar/delete/move).
> `report_spam`/`report_ham` (and `bulk_action` spam/notspam) train THIS server's
> spam filter, which doesn't apply to a remote provider, so they reject
> `external_account_id` — move to the provider's Junk folder instead.

- **list_messages** — List messages in a mailbox folder with cursor pagination (optional `external_account_id`)
- **read_message** — Get a single message by IMAP UID with full body (optional `external_account_id`)
- **send_message** — Send an email from the mailbox — or, with `external_account_id`, from a connected account via its own SMTP (dual safety gates, validates total recipients ≤ 10, requires body)
- **delete_message** — Permanently delete a message by IMAP UID (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)
- **move_message** — Move a message to a different IMAP folder
- **list_folders** — List all IMAP folders for the mailbox
- **update_message_flags** — Update flags (read/unread, starred/unstarred) on a message
- **download_attachment** — Download a single attachment by index from a message
- **download_all_attachments** — Download all attachments as a ZIP archive
- **get_raw_message** — Get the full RFC 822 raw source of a message
- **save_draft** — Save a new draft via IMAP APPEND
- **update_draft** — Update an existing draft (replaces the old draft)
- **report_spam** — Report a message as spam (trains Rspamd Bayesian filter)
- **report_ham** — Mark a message as not spam (trains Rspamd Bayesian filter)
- **bulk_action** — Perform a bulk action on up to 50 messages (read, unread, star, unstar, delete, move, spam, notspam)

### Connected accounts (message token)
Connect and manage external mailboxes (Gmail/Outlook/IMAP) the mailbox reads and sends through. Credentials are never returned by any tool.
- **list_external_accounts** — List connected external accounts (id, email, provider, status) — the source of valid `external_account_id` values
- **detect_external_account** — Detect provider preset (host/port/encryption, app-password vs OAuth) from an email address
- **test_external_account** — Test unsaved IMAP/SMTP credentials without persisting (requires `TREKMAIL_ALLOW_MIGRATION=true`)
- **create_external_account** — Connect an external account (test-gated; requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)
- **update_external_account** — Update a connected account's settings/credentials (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)
- **test_saved_external_account** — Re-test a saved account and lift its circuit breaker (requires `TREKMAIL_ALLOW_MIGRATION=true`)
- **delete_external_account** — Remove a connected account and its stored credentials (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)

### Folders (message token)
- **create_folder** — Create a new IMAP folder
- **rename_folder** — Rename an existing IMAP folder
- **delete_folder** — Delete a leaf IMAP folder and its messages; child folders must be deleted explicitly first (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)
- **empty_folder** — Empty all messages from a folder without deleting the folder

### Scheduled Messages (message token)
- **schedule_message** — Schedule a message to be sent at a future time (optional IANA `timezone` resolves naïve datetimes; explicit ISO offset always wins)
- **list_scheduled** — List pending scheduled messages
- **reschedule_message** — Re-time a pending scheduled message in place (no resend, lighter throttle than schedule + cancel)
- **cancel_scheduled** — Cancel a scheduled message before it sends

### Contacts (message token)
- **list_contacts** — List contacts with optional search
- **create_contact** — Create a new contact
- **update_contact** — Update a contact's details
- **delete_contact** — Delete a contact (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)
- **import_contacts** — Import contacts from CSV or VCF data
- **export_contacts** — Export all contacts as VCF

### Contact Groups (message token)
- **list_contact_groups** — List contact groups
- **list_contact_group_members** — List the contacts in a group (paginated)
- **create_contact_group** — Create a new contact group
- **update_contact_group** — Rename or update a contact group
- **delete_contact_group** — Delete a contact group (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)
- **add_contact_group_members** — Add contacts to a group
- **remove_contact_group_members** — Remove contacts from a group

### Calendar (message token)
- **list_calendar_events** — List calendar events with optional date range filter
- **create_calendar_event** — Create a new calendar event
- **update_calendar_event** — Update an existing calendar event
- **delete_calendar_event** — Delete a calendar event (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)

### Compose Helpers (message token)
- **prepare_reply** — Get pre-filled reply data (quoted body, headers) for a message
- **prepare_reply_all** — Get pre-filled reply-all data for a message
- **prepare_forward** — Get pre-filled forward data for a message

### Identities (message token)
- **list_identities** — List send-from identities for the mailbox
- **create_identity** — Create a new send-from identity
- **update_identity** — Update an identity's display name, signature, or default flag
- **delete_identity** — Delete a send-from identity (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)

### Templates (message token)
- **list_templates** — List message templates
- **create_template** — Create a new message template
- **update_template** — Update a message template
- **delete_template** — Delete a message template (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)

### Blocked Senders (message token)
- **list_blocked_senders** — List blocked sender addresses
- **block_sender** — Block a sender address (moves future mail to Junk)
- **unblock_sender** — Unblock a sender address

### SMTP (ops token)
- **get_smtp_config** — View current SMTP mode and connection details
- **update_smtp_config** — Update SMTP configuration (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **delete_smtp_connection** — Delete a custom SMTP connection (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **test_smtp** — Start an async SMTP connection test (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **get_smtp_test_status** — Poll SMTP test results

> The five tools above are the legacy account-level SMTP controls — **deprecated for routing** (kept for back-compat only). Use the per-domain SMTP routing + account-default tools below for outbound delivery configuration.

### Domain SMTP Routing (ops token)
- **get_domain_smtp** — Get a domain's outbound route (mode + selected profile; `effective_smtp_mode` resolves `inherit` to the account default)
- **set_domain_smtp** — Set a domain's route: `platform` (managed) / `profile` (saved profile) / `not_configured` / `inherit` (follow the account default) (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **list_domain_smtp_profiles** — List the account's reusable saved SMTP profiles plus per-profile usage counts
- **create_domain_smtp_profile** — Create a reusable SMTP profile and apply it to a domain — stores credentials (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **update_domain_smtp_profile** — Update a saved profile (affects every domain using it) (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **delete_domain_smtp_profile** — Delete a saved profile (domains using it are reassigned) (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **test_domain_smtp** — Test a route, connects out (returns `job_id`) (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **get_domain_smtp_test_status** — Poll a route test by `job_id`
- **get_account_smtp_default** — Get the account-wide default route new domains start on (`default_smtp_mode` + `effective_default_smtp_mode` plan-baseline fallback)
- **set_account_smtp_default** — Set the account-wide default (`platform` / `profile` / `not_configured`); optional `apply_to_all` switches every existing domain now (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)

### Tickets (ops token)
- **list_tickets** — List support tickets with optional status/category filters
- **get_ticket** — Get ticket details
- **get_ticket_messages** — Get all messages in a ticket conversation
- **create_ticket** — Create a new support ticket
- **reply_to_ticket** — Reply to an existing ticket
- **close_ticket** — Close a ticket

### Account (ops token)
- **whoami** — Get current token info and permissions
- **get_account** — Get account details, plan, limits, and usage
- **get_billing_status** — Get billing and subscription info
- **list_invoices** — List invoice history

### Message Token Management (ops token)
- **create_message_token** — Create a message API token for a mailbox (returns plaintext once)
- **list_message_tokens** — List all message tokens for a mailbox
- **revoke_message_token** — Revoke a message token (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)

### Migrations (ops token)
- **test_migration_connection** — Validate IMAP credentials and discover source folders with message counts
- **list_migrations** — List migrations with optional status/mailbox filters
- **get_migration** — Get detailed migration status including per-folder progress
- **start_migration** — Start a new email migration (gated: `TREKMAIL_ALLOW_MIGRATION` + `confirm_start=true`)
- **cancel_migration** — Cancel a running migration (always available — safety operation, requires `confirm_cancel=true`)
- **retry_migration** — Retry a failed or cancelled migration (gated: `TREKMAIL_ALLOW_MIGRATION` + `confirm_retry=true`)
- **delete_migration** — Delete a migration record (gated: `TREKMAIL_ALLOW_MIGRATION` + `confirm_delete=true`)

### Bulk Migrations (ops token)
- **preview_bulk_migration** — Validate and preview a bulk migration batch (gated: `TREKMAIL_ALLOW_MIGRATION`)
- **start_bulk_migration** — Start a bulk migration batch (gated: `TREKMAIL_ALLOW_MIGRATION` + `confirm_start=true`)
- **list_bulk_migrations** — List bulk migration batches with optional status filter
- **get_bulk_migration** — Get details of a bulk migration batch
- **cancel_bulk_migration** — Cancel an active bulk batch (requires `confirm_cancel=true`)
- **retry_bulk_migration** — Retry failed jobs in a batch (gated: `TREKMAIL_ALLOW_MIGRATION` + `confirm_retry=true`)
- **resume_bulk_migration** — Resume a paused batch (requires `confirm_resume=true`)
- **delete_bulk_migration** — Delete a terminal bulk migration batch (gated: `TREKMAIL_ALLOW_MIGRATION` + `confirm_delete=true`)
- **update_bulk_migration_job_password** — Update source password for a failed job (gated: `TREKMAIL_ALLOW_MIGRATION`)

### Spam Metrics (ops token)
- **get_spam_metrics** — Get daily spam protection metrics for a domain
- **get_spam_summary** — Get aggregated spam protection summary for a domain

### Email Verifier (ops token)
- **verify_email** — Verify a single email address
- **verify_email_bulk** — Submit a bulk verification job
- **verify_job_status** — Check job progress and results
- **verify_job_download** — Download job results as CSV
- **verify_credits** — Check remaining credit balance
- **verify_list_jobs** — List all verification jobs
- **verify_cancel_job** — Cancel a running job and refund unprocessed credits
- **verify_delete_job** — Permanently delete a job and all results (GDPR)

### Cloudflare (ops token)
- **validate_cloudflare_token** — Validate a Cloudflare API token
- **list_cloudflare_zones** — List DNS zones accessible by a Cloudflare token
- **connect_cloudflare_domains** — Connect domains to a Cloudflare account (creates new domains if needed)
- **preview_cloudflare_dns** — Preview DNS changes that would be applied via Cloudflare. Optional `included_records` (`{ domain_id: [record_ids] }`) previews only selected records
- **apply_cloudflare_dns** — Apply DNS changes to Cloudflare-managed zones. Use `included_records` to write only chosen records and skip the rest (e.g. MX now, DKIM later); omit it to apply all. `confirmed_conflicts` authorises replacing records flagged as conflicting
- **list_cloudflare_tokens** — List stored Cloudflare tokens
- **delete_cloudflare_token** — Delete a stored Cloudflare token (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)

## Idempotency

All mutating tools (POST/PUT) generate **deterministic idempotency keys** from `sha256(tool_name + canonical_params)`. This means:

- The same tool call with the same params always produces the same key
- Agent retries hit the API's idempotency cache — no duplicate side effects
- You can override with an explicit `idempotency_key` parameter on any mutating tool

## Safety

### Two-Step Delete
Mailbox deletion requires two separate tool calls:
1. `create_delete_intent` → returns intent with 10-minute expiry
2. `confirm_delete_intent` → executes deletion (irreversible)

### Destructive Operations Gate
Both delete tools require `TREKMAIL_ALLOW_DESTRUCTIVE=true`. Without it, they return an error message explaining how to enable.

The `confirm_delete_intent` tool has an additional `confirm: true` parameter that must be explicitly set.

### Sending Safety Gates
The `send_message` tool has **two independent safety gates** that must both pass:

1. **Environment gate:** `TREKMAIL_ALLOW_SENDING=true` must be set in the environment
2. **Per-call gate:** `confirm_send=true` must be passed as a parameter

This dual-gate design prevents accidental email sends. The agent must both be configured to allow sending and explicitly confirm each send.

### Migration Safety Gates
The `start_migration`, `retry_migration`, and `delete_migration` tools require `TREKMAIL_ALLOW_MIGRATION=true` in the environment. `cancel_migration` is always available as a safety operation. `test_migration_connection` requires the gate because it makes outbound IMAP connections. Read-only tools (`list_migrations`, `get_migration`) work without any gate.

Additionally, each write tool requires a per-call confirmation parameter (`confirm_start`, `confirm_cancel`, or `confirm_retry` set to `true`).

## Claude Desktop Configuration

```json
{
  "mcpServers": {
    "trekmail": {
      "command": "node",
      "args": ["/path/to/trekmail-mcp/build/index.js"],
      "env": {
        "TREKMAIL_BASE_URL": "https://trekmail.net",
        "TREKMAIL_API_TOKEN": "tm_live_your_token",
        "TREKMAIL_MESSAGE_TOKEN": "tm_msg_your_token",
        "TREKMAIL_ALLOW_SENDING": "true"
      }
    }
  }
}
```

## Claude Code Configuration

```json
{
  "mcpServers": {
    "trekmail": {
      "command": "node",
      "args": ["/path/to/trekmail-mcp/build/index.js"],
      "env": {
        "TREKMAIL_BASE_URL": "https://trekmail.net",
        "TREKMAIL_API_TOKEN": "tm_live_your_token",
        "TREKMAIL_MESSAGE_TOKEN": "tm_msg_your_token",
        "TREKMAIL_ALLOW_SENDING": "true"
      }
    }
  }
}
```

## Workflow Examples

### DNS Recheck Loop
```
1. dns_recheck(domain_id: 5) → { check_id: 42 }
2. get_dns_check(check_id: 42) → { status: "pending" }
3. (wait) get_dns_check(check_id: 42) → { status: "complete", results: {...} }
```

### Create Mailbox + Forwarding (single destination)
```
1. create_mailbox_generated_password(domain_id: 5, local_part: "alice")
   → { id: 10, email: "alice@example.com", password: "..." }
2. set_forwarding(mailbox_id: 10, enabled: true, targets: ["alice@gmail.com"], keep_copy: true)
```

### Create Mailbox + Multi-Destination Forwarding
```
# Fan one shared mailbox out to several humans.
1. create_mailbox_generated_password(domain_id: 5, local_part: "sales")
   → { id: 14, email: "sales@example.com", password: "..." }
2. get_forwarding(mailbox_id: 14)
   → { enabled: false, targets: [], keep_copy: false, destination_limit: 15 }   # Pro plan
3. set_forwarding(
     mailbox_id: 14,
     enabled: true,
     targets: ["alice@example.com", "bob@example.com", "carol@example.com"],
     keep_copy: true        # also leave a copy in sales@ for record-keeping
   )
```

### Create Mailbox with Dedicated Storage
```
# Carve out 5 GB just for this mailbox — other shared mailboxes can't grow into it.
1. create_mailbox_generated_password(
     domain_id: 5,
     local_part: "ceo",
     storage_allocation_mb: 5120
   ) → { id: 11, email: "ceo@example.com", password: "...", is_pooled_storage: false, storage_allocation_mb: 5120 }
```

### Bulk Create with Mixed Storage Modes
```
# Mix shared and dedicated in one call. The sum of all storage_allocation_mb
# across the batch is checked against the available pool — if it would
# over-commit, the entire batch is rejected with 422 storage_pool_exceeded.
1. bulk_create_mailboxes(items: [
     { domain_id: 5, local_part: "support" },                                  # shared
     { domain_id: 5, local_part: "founder",  storage_allocation_mb: 10240 },  # 10 GB dedicated
     { domain_id: 5, local_part: "team-lead", storage_allocation_mb: 5120 },  # 5 GB dedicated
   ])
```

### Invite Flow
```
1. create_invite(domain_id: 5, local_part: "bob", recipient_email: "bob@gmail.com")
   → { id: 1, status: "pending", invite_url: "..." }
```

### Invite with Pre-Allocated Storage
```
# Pending dedicated invites count against the available pool until they
# are redeemed or expire — no over-committing.
1. create_invite(
     domain_id: 5,
     local_part: "exec",
     recipient_email: "exec@external.com",
     storage_allocation_mb: 10240
   ) → { id: 2, status: "pending", storage_allocation_mb: 10240 }
# When the recipient redeems, the new mailbox inherits the 10 GB dedicated allocation.
# If the pool no longer fits at redeem time, the new mailbox falls back to shared
# (the recipient sees a notice on the success page) — redeem itself never fails.
```

### Safe Delete
```
1. create_delete_intent(mailbox_id: 10) → { id: 7, expires_at: "...", status: "pending" }
2. confirm_delete_intent(intent_id: 7, confirm: true) → { status: "confirmed" }
```

### Monitor Inbox
```
1. list_messages(folder: "INBOX", limit: 10, unread_only: true)
   → { messages: [...], pagination: { has_more: true, next_before_uid: 45 } }
2. read_message(uid: 50) → { from, subject, body_text, body_html, attachments: [...] }
```

### Email Migration
```
1. test_migration_connection(source_host: "imap.gmail.com", source_port: 993, source_security: "ssl", source_email: "user@gmail.com", source_password: "app-password")
   → { success: true, folders: { "INBOX": 1234, "Sent": 567, ... } }
2. start_migration(mailbox_id: 10, provider: "gmail", source_host: "imap.gmail.com", source_port: 993, source_security: "ssl", source_email: "user@gmail.com", source_password: "app-password", target_password: "mailbox-pass", confirm_start: true)
   → { id: 5, status: "pending", ... }
3. get_migration(id: 5) → { status: "processing", progress: 45, folders: [...] }
4. (poll) get_migration(id: 5) → { status: "completed", progress: 100, imported_messages: 1801 }
```

### Send Email with Confirmation
```
1. send_message(
     to: ["alice@example.com"],
     subject: "Weekly Report",
     body_text: "Please find the report attached.",
     confirm_send: true,
     idempotency_key: "weekly-report-2026-02-07"
   ) → { status: "queued", message_id: "uuid@trekmail.net", queued_at: "..." }
```

## Drive Tools

42 tools for the `/api/v1/drive/*` REST surface (38 file/folder/share/addon
tools + 4 sync-device password tools added 2026-05-23). Drive is available
through both the TrekMail REST API and this MCP server when the ops token
has the matching Drive scopes. See the TrekMail app/API docs for the full
REST reference.

| Tool | Purpose |
|---|---|
| `drive_spaces_list` | List Drive spaces this token can enumerate (account_drive + per-mailbox) |
| `drive_storage_summary` | Account-wide pool snapshot (used / limit / addon flags) |
| `drive_space_usage` | Per-space quota snapshot |
| `drive_browse_folder` | Cursor-paginated listing of one folder's files + subfolders |
| `drive_folder_tree` | Flat tree of every folder in a space |
| `drive_select_all_ids` | Bulk-select helper (capped at 5000 ids) |
| `drive_file_get` | File metadata |
| `drive_file_download_url` | Short-lived download URL (forced attachment) |
| `drive_file_rename` / `_move` / `_trash` / `_restore` / `_purge` | File CRUD |
| `drive_folder_create` / `_update` / `_move` / `_trash` / `_restore` / `_purge` | Folder CRUD; `_update` accepts `name` and/or `color` (#RRGGBB); `_create` accepts `is_shared` to publish to the whole account immediately |
| `drive_folder_share_with_account` / `_stop_sharing` | Toggle whether a folder is visible to every mailbox in the account (Phase H — moves the folder + subtree from mailbox-personal Drive to account-drive when needed) |
| `drive_trash_list` / `_empty` | Trash listing + nuke |
| `drive_bulk_trash` / `_restore` / `_move` / `_purge` | One call, N items (cap 5000) |
| `drive_share_create` / `_list` / `_revoke` | Public share-links (raw token returned ONCE) |
| `drive_file_upload` | **High-level: one tool, full flow.** Streams local file → returned upload URL(s) → registers as available. Use this by default. |
| `drive_upload_initiate` / `_complete` / `_refresh_parts` / `_abort` | Low-level multipart upload primitives — for agents that PUT bytes themselves |
| `drive_addon_get` / `_pricing` / `_cancellation_preview` | Drive Storage Add-on (read-only; purchase / resize / cancel are dashboard-only by product decision) |
| `drive_device_list` | List Drive sync-device passwords (label, scopes, mailbox binding, last-used, expiry, revoked-at; never plaintext) |
| `drive_device_create` | Mint a new `dsync_…` credential for rclone / Cyberduck / X-Plore / DAVx⁵ / Documents / FolderSync. Plaintext returned ONCE in `data.password`. Rate-limited 20/h per account |
| `drive_device_revoke` / `_rotate` | Revoke a device password (idempotent) or atomically rotate (revoke old + mint new, inherits label / scopes / mailbox). Both gated by `TREKMAIL_ALLOW_DESTRUCTIVE=true`. Rotate is rate-limited 10/h per account |

`{space}` parameters accept `"account"` (account-drive singleton),
`"mailbox:N"` (mailbox-personal), or a numeric `DriveSpace.id`.

### Plan / addon gating

Drive scopes light up for any account on a paid plan **OR** with an
active Drive Storage Add-on (mirrors how `verify:*` works for the
Email Verifier). Free + addon active is a fully supported path —
mint a token with `drive:account:read` etc. and it works. When the
addon enters its 7-day post-cancellation grace window, write/share/
purge tokens lose access; read tokens keep working.

Drive API/MCP scopes:

| Scope | Enables |
|---|---|
| `drive:account:read` | Browse Account Drive, inspect metadata, list folders/trash/share links, and request download URLs |
| `drive:account:write` | Upload files, create/update/move/trash/restore files and folders in Account Drive |
| `drive:account:share` | Create and revoke public share links for Account Drive files |
| `drive:account:purge` | Permanently purge trashed Account Drive files/folders and empty trash |
| `drive:mailbox:read` | Browse mailbox Drive spaces allowed by token mailbox constraints |
| `drive:mailbox:write` | Upload and mutate files/folders in allowed mailbox Drive spaces |
| `drive:mailbox:share` | Create and revoke public share links for allowed mailbox Drive files |
| `drive:mailbox:purge` | Permanently purge trashed files/folders in allowed mailbox Drive spaces |
| `drive:addon:read` | Read Drive Storage Add-on status, pricing, and cancellation preview |

### Upload flow

**Default — `drive_file_upload`** (one tool, all three steps):

```
drive_file_upload(space="account", local_path="/path/to/report.pdf",
                  folder_id=42, client_mime="application/pdf")
```

The wrapper:
1. Reads file size and calls `drive_upload_initiate`.
2. **Streams** the file straight to the returned upload URL(s).
   Bytes do NOT pass through MCP infrastructure beyond the wrapper
   process — and they never touch the API server. Memory stays
   bounded for files of any size (tested with multi-GB).
3. For files ≥ 100 MB, uses multipart: 50 MB chunks, captures each
   upload part ETag, refreshes any expired part URL once before failing.
4. Calls `drive_upload_complete` to register the file as available.
5. On any error along the way, calls `drive_upload_abort` to release
   the quota reservation. (The reservation is also reclaimed by the
   server-side cleanup — abort is a fast path, not a guarantee.)

**Low-level primitives** (`drive_upload_initiate` etc.) stay available
for agents that want to drive the PUT phase themselves — e.g. uploads
from a remote source instead of the MCP host's filesystem.

### Audit attribution

Every mutating Drive tool stamps `actor_type='api_token'` and
`api_token_id=<token id>` on the audit row, so the dashboard's API
audit tab can filter by token. The mailbox/user context the token
is acting on behalf of is preserved in the existing `mailbox_id` /
`metadata.actor_user_id` fields.

## Development

```bash
# Install dependencies
npm install

# Run in dev mode (tsx, no build required)
TREKMAIL_BASE_URL=https://trekmail.net TREKMAIL_API_TOKEN=tm_live_test npm run dev

# Build
npm run build

# Run tests
npm test

# Watch tests
npm run test:watch

# Type-check only
npm run lint
```
