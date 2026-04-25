# TrekMail MCP Server

A Model Context Protocol (MCP) server that exposes the TrekMail API v1 as 143 agent tools. This is a thin adapter — all business logic lives in the TrekMail API; this server handles transport, authentication, retries, and safety gates.

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
| **Ops token** | `TREKMAIL_API_TOKEN` | `tm_live_` | 91 infrastructure tools (domains, DNS, mailboxes, invites, aliases, forwarding, mail filters, auto-reply, sieve, delete intents, migrations, SMTP, tickets, account, billing, spam stats, verifier, message token management, Cloudflare DNS) |
| **Message token** | `TREKMAIL_MESSAGE_TOKEN` | `tm_msg_` | 52 message tools (messages, attachments, drafts, bulk actions, folders, scheduled send, contacts, contact groups, calendar, compose helpers, identities, templates, blocked senders) |

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
| `TREKMAIL_USER_AGENT` | No | `trekmail-mcp/1.0.0` | User-Agent header |
| `TREKMAIL_ALLOW_DESTRUCTIVE` | No | `false` | Enable destructive tools (delete intents, domain delete, password change, pause, SMTP config, revoke token, delete Cloudflare token) |
| `TREKMAIL_ALLOW_SENDING` | No | `false` | Enable `send_message` tool |
| `TREKMAIL_ALLOW_MIGRATION` | No | `false` | Enable migration write tools (`start_migration`, `retry_migration`, `delete_migration`, `delete_bulk_migration`, `update_bulk_migration_job_password`, `test_migration_connection`) |

## Tools (143)

### Domains (ops token)
- **list_domains** — List domains with optional status/search filters
- **get_domain** — Get details for a specific domain
- **create_domain** — Add a new domain to the account
- **delete_domain** — Delete a domain (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **update_domain_catch_all** — Configure or clear the catch-all address
- **retry_domain_dkim** — Retry DKIM key provisioning
- **update_domain_note** — Update the admin note on a domain
- **bulk_add_domains** — Add up to 20 domains in one call

### DNS (ops token)
- **get_dns_requirements** — Get required DNS records for a domain
- **dns_recheck** — Trigger async DNS verification (returns check ID)
- **get_dns_check** — Poll DNS check status/results

### Mailboxes (ops token)
- **list_mailboxes** — List mailboxes with optional domain/search filters
- **get_mailbox** — Get details for a specific mailbox
- **create_mailbox_generated_password** — Create mailbox with auto-generated one-time password
- **change_mailbox_password** — Change the password for a mailbox (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **update_mailbox_note** — Update the admin note on a mailbox
- **pause_mailbox** — Disable a mailbox (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)
- **resume_mailbox** — Re-enable a paused mailbox
- **enable_imap** — Enable IMAP access for a mailbox (required for Message API)
- **bulk_create_mailboxes** — Create 1-100 mailboxes at once (returns per-item results)

### Invites (ops token)
- **create_invite** — Send a setup invite to a recipient
- **create_invites_bulk** — Send up to 100 setup invites in one call

### Aliases (ops token)
- **list_aliases** — List all aliases for a mailbox (includes primary address and plan limits)
- **create_alias** — Add an alias to a mailbox (cross-domain supported, Starter+ plans)
- **update_alias** — Toggle receiving, sending, or active/inactive status
- **delete_alias** — Permanently remove an alias (gated: `TREKMAIL_ALLOW_DESTRUCTIVE`)

### Forwarding (ops token)
- **get_forwarding** — Get forwarding config for a mailbox
- **set_forwarding** — Configure forwarding targets, enable/disable, keep-copy

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
- **list_messages** — List messages in a mailbox folder with cursor pagination
- **read_message** — Get a single message by IMAP UID with full body
- **send_message** — Send an email from the mailbox (dual safety gates, validates total recipients ≤ 10, requires body)
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

### Folders (message token)
- **create_folder** — Create a new IMAP folder
- **rename_folder** — Rename an existing IMAP folder
- **delete_folder** — Delete an IMAP folder and its contents (requires `TREKMAIL_ALLOW_DESTRUCTIVE=true`)
- **empty_folder** — Empty all messages from a folder without deleting the folder

### Scheduled Messages (message token)
- **schedule_message** — Schedule a message to be sent at a future time
- **list_scheduled** — List pending scheduled messages
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
- **preview_cloudflare_dns** — Preview DNS changes that would be applied via Cloudflare
- **apply_cloudflare_dns** — Apply DNS changes to Cloudflare-managed zones
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

### Create Mailbox + Forwarding
```
1. create_mailbox_generated_password(domain_id: 5, local_part: "alice")
   → { id: 10, email: "alice@example.com", password: "..." }
2. set_forwarding(mailbox_id: 10, enabled: true, targets: ["alice@gmail.com"], keep_copy: true)
```

### Invite Flow
```
1. create_invite(domain_id: 5, local_part: "bob", recipient_email: "bob@gmail.com")
   → { id: 1, status: "pending", invite_url: "..." }
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
