import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageToolHandlers(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "list_messages",
    {
      title: "List Messages",
      description:
        "List messages in a mailbox IMAP folder, sorted newest-first with cursor-based pagination. Requires a message token with messages:read scope.",
      inputSchema: {
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("IMAP folder path (default: INBOX)"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("Max messages to return (1-50, default 20)"),
        before_uid: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Cursor: only return messages with UID < this value"),
        since: z
          .string()
          .optional()
          .describe("Only return messages since this date (ISO 8601)"),
        unread_only: z
          .boolean()
          .optional()
          .describe("Only return unread messages"),
        search: z
          .string()
          .max(200)
          .optional()
          .describe("Filter by subject keyword (max 200 chars)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Read from a connected external account instead of the mailbox"),
      },
    },
    async ({ folder, limit, before_uid, since, unread_only, search, external_account_id }) => {
      return callApi(() =>
        client.listMessages({ folder, limit, before_uid, since, unread_only, search, external_account_id }),
      );
    },
  );

  server.registerTool(
    "read_message",
    {
      title: "Read Message",
      description:
        "Get a single message by IMAP UID, including full body and attachment metadata. Requires a message token with messages:read scope.",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("IMAP folder path (default: INBOX)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Read from a connected external account instead of the mailbox"),
      },
    },
    async ({ uid, folder, external_account_id }) => {
      return callApi(() => client.getMessage(uid, { folder, external_account_id }));
    },
  );

  server.registerTool(
    "send_message",
    {
      title: "Send Message",
      description:
        "Send an email from the mailbox. Requires a message token with messages:send scope. Both TREKMAIL_ALLOW_SENDING=true and confirm_send=true are required as safety gates. The message is queued for delivery and a message_id is returned immediately.",
      inputSchema: {
        to: z
          .array(z.string().email())
          .min(1)
          .max(10)
          .describe("Recipient email addresses (max 10 total across to+cc+bcc)"),
        cc: z
          .array(z.string().email())
          .max(10)
          .optional()
          .describe("CC recipient email addresses"),
        bcc: z
          .array(z.string().email())
          .max(10)
          .optional()
          .describe("BCC recipient email addresses"),
        subject: z
          .string()
          .min(1)
          .max(998)
          .describe("Email subject line (max 998 chars)"),
        body_text: z
          .string()
          .max(204800)
          .optional()
          .describe("Plain text body (max 200 KB). At least one of body_text or body_html is required."),
        body_html: z
          .string()
          .max(512000)
          .optional()
          .describe("HTML body (max 500 KB). At least one of body_text or body_html is required."),
        attachments: z
          .array(
            z.object({
              filename: z.string().max(255),
              content_type: z.string().max(255),
              content_base64: z.string(),
            }),
          )
          .max(5)
          .optional()
          .describe("File attachments (max 5 files, 5 MB each, 10 MB total)"),
        reply_to_message_id: z
          .string()
          .max(500)
          .optional()
          .describe("Message-ID to reply to (sets In-Reply-To and References headers)"),
        headers: z
          .record(z.string(), z.string().max(998))
          .optional()
          .describe(
            "Optional whitelisted outbound headers. Allowed: 'List-Unsubscribe', 'List-Unsubscribe-Post' (RFC 8058), 'Reply-To', and any 'X-*' custom tracking header. Values must not contain CR/LF and are capped at 998 chars per RFC 2822. Managed headers (From, Subject, Date, Message-Id, Authentication-Results, DKIM-Signature, etc.) are rejected with 422.",
          ),
        confirm_send: z
          .boolean()
          .describe(
            "Must be true to send. This is a safety gate to prevent accidental email sends.",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params.",
          ),
        apply_default_recipients: z
          .boolean()
          .optional()
          .describe(
            "Set false to skip this mailbox's Default CC/BCC on this one message. They are applied by default, exactly as they are for mail written in the web app.",
          ),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Send FROM a connected external account (Gmail/Outlook/IMAP) instead of the mailbox. The message goes out through that account's own SMTP and is saved to its Sent folder.",
          ),
        identity_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Use one identity returned by list_identities. For a connected-inbox Send As identity, external_account_id must identify the same source.",
          ),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({
      to,
      cc,
      bcc,
      subject,
      body_text,
      body_html,
      attachments,
      reply_to_message_id,
      headers,
      confirm_send,
      idempotency_key,
      external_account_id,
      identity_id,
      apply_default_recipients,
    }) => {
      if (!config.allowSending) {
        return errorResult(
          "Sending is disabled. Set TREKMAIL_ALLOW_SENDING=true to enable email sending via the MCP server.",
        );
      }

      if (!confirm_send) {
        return errorResult(
          "Send not confirmed. Set confirm_send=true to send the email. This action will deliver a real email to the recipients.",
        );
      }

      // Validate at least one body is provided
      if (!body_text && !body_html) {
        return errorResult(
          "At least one of body_text or body_html is required.",
        );
      }

      // Validate total recipient count (API limit is 10)
      const totalRecipients =
        to.length + (cc?.length ?? 0) + (bcc?.length ?? 0);
      if (totalRecipients > 10) {
        return errorResult(
          `Total recipients (to + cc + bcc) must not exceed 10. Got ${totalRecipients}.`,
        );
      }

      // Build API request body
      const body: Record<string, unknown> = {
        to,
        subject,
        body: {
          text: body_text ?? null,
          html: body_html ?? null,
        },
      };

      if (cc && cc.length > 0) body.cc = cc;
      if (bcc && bcc.length > 0) body.bcc = bcc;
      if (attachments && attachments.length > 0) body.attachments = attachments;
      if (reply_to_message_id) body.reply_to_message_id = reply_to_message_id;
      if (headers && Object.keys(headers).length > 0) body.headers = headers;
      if (external_account_id) body.external_account_id = external_account_id;
      if (identity_id) body.identity_id = identity_id;
      if (apply_default_recipients === false) body.apply_default_recipients = false;

      // Generate idempotency key (exclude confirm_send from hash). The external
      // account is part of the identity — the same message from two accounts is
      // two distinct sends and must not dedupe to one.
      const idemKey = idempotencyKey(
        "send_message",
        { to, cc, bcc, subject, body_text, body_html, attachments, reply_to_message_id, headers, external_account_id, identity_id, apply_default_recipients },
        idempotency_key,
      );

      return callApi(() => client.sendMessage(body, idemKey));
    },
  );

  server.registerTool(
    "delete_message",
    {
      title: "Delete Message",
      description:
        "Permanently delete a message by IMAP UID. This marks the message as \\Deleted and expunges it. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message to delete"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("IMAP folder path (default: INBOX)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Act on a connected external account instead of the mailbox"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ uid, folder, external_account_id }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Message deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable.",
        );
      }
      return callApi(() => client.deleteMessage(uid, { folder, external_account_id }));
    },
  );

  server.registerTool(
    "move_message",
    {
      title: "Move Message",
      description:
        "Move a message to a different IMAP folder. Copies the message to the destination and deletes it from the source.",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message to move"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("Source IMAP folder (default: INBOX)"),
        destination: z
          .string()
          .max(255)
          .describe("Destination IMAP folder path"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Act on a connected external account instead of the mailbox"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ uid, folder, destination, external_account_id }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to move messages.",
        );
      }
      return callApi(() =>
        client.moveMessage(uid, { folder, destination, external_account_id }),
      );
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "List Folders",
      description:
        "List all IMAP folders for the mailbox (or a connected external account). Returns each folder's name, raw path, delimiter, and hierarchy metadata (parent path, depth, has_children) so the folder tree can be reconstructed. Use the raw path with create_folder's `parent` to nest new folders.",
      inputSchema: {
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("List a connected external account's folders instead of the mailbox"),
      },
    },
    async ({ external_account_id }) => {
      return callApi(() => client.listFolders({ external_account_id }));
    },
  );

  server.registerTool(
    "update_message_flags",
    {
      title: "Update Message Flags",
      description:
        "Update flags (read/unread, starred/unstarred) on a message by IMAP UID. Requires a message token with messages:write scope.",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("IMAP folder path (default: INBOX)"),
        seen: z
          .boolean()
          .optional()
          .describe("Mark as read (true) or unread (false)"),
        flagged: z
          .boolean()
          .optional()
          .describe("Mark as starred (true) or unstarred (false)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Act on a connected external account instead of the mailbox"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ uid, folder, seen, flagged, external_account_id }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update message flags.",
        );
      }
      if (seen === undefined && flagged === undefined) {
        return errorResult(
          "At least one flag (seen, flagged) must be specified.",
        );
      }

      const flags: Record<string, boolean> = {};
      if (seen !== undefined) flags.seen = seen;
      if (flagged !== undefined) flags.flagged = flagged;

      return callApi(() =>
        client.updateMessageFlags(uid, flags, { folder, external_account_id }),
      );
    },
  );

  // --- Attachments ---

  server.registerTool(
    "download_attachment",
    {
      title: "Download Attachment",
      description:
        "Download a single attachment from a message by its index. Returns base64-encoded content. Warning: large attachments (up to 25 MB) may produce very long responses.",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message"),
        index: z
          .number()
          .int()
          .min(0)
          .describe("Zero-based attachment index"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("IMAP folder path (default: INBOX)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Download from a connected external account (Gmail/Outlook/IMAP) instead of the mailbox"),
      },
    },
    async ({ uid, index, folder, external_account_id }) => {
      return callApi(() =>
        client.downloadAttachment(uid, index, { folder, external_account_id }),
      );
    },
  );

  server.registerTool(
    "download_all_attachments",
    {
      title: "Download All Attachments",
      description:
        "Download all attachments from a message as a base64-encoded ZIP file. Warning: may produce very long responses for messages with large attachments (up to 25 MB total).",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("IMAP folder path (default: INBOX)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Download from a connected external account (Gmail/Outlook/IMAP) instead of the mailbox"),
      },
    },
    async ({ uid, folder, external_account_id }) => {
      return callApi(() =>
        client.downloadAllAttachments(uid, { folder, external_account_id }),
      );
    },
  );

  // --- Raw Message ---

  server.registerTool(
    "get_raw_message",
    {
      title: "Get Raw Message",
      description:
        "Get the full RFC822 raw source of a message, including all headers. Useful for debugging delivery issues, analyzing headers, or forwarding as .eml. The API transports the source base64-encoded (raw_base64); this tool decodes it into a `raw` text field (non-UTF-8 bytes become replacement characters).",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("IMAP folder path (default: INBOX)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Read from a connected external account (Gmail/Outlook/IMAP) instead of the mailbox"),
      },
    },
    async ({ uid, folder, external_account_id }) => {
      return callApi(async () => {
        const result = await client.getRawMessage(uid, { folder, external_account_id });
        if (
          result &&
          typeof result === "object" &&
          typeof (result as Record<string, unknown>).raw_base64 === "string"
        ) {
          const { raw_base64, ...rest } = result as Record<string, unknown>;
          return {
            ...rest,
            raw: Buffer.from(raw_base64 as string, "base64").toString("utf8"),
          };
        }
        return result;
      });
    },
  );

  // --- Drafts ---

  server.registerTool(
    "save_draft",
    {
      title: "Save Draft",
      description:
        "Save a new draft to the IMAP Drafts folder. Accepts structured JSON with to, cc, bcc, subject, body (text/html), and optional base64 attachments. Returns the new draft's uid — pass it to update_draft or delete_message to act on this draft later.",
      inputSchema: {
        to: z
          .array(z.string().email())
          .max(10)
          .optional()
          .describe("Recipient email addresses"),
        cc: z
          .array(z.string().email())
          .max(10)
          .optional()
          .describe("CC email addresses"),
        bcc: z
          .array(z.string().email())
          .max(10)
          .optional()
          .describe("BCC email addresses"),
        subject: z
          .string()
          .max(998)
          .optional()
          .describe("Email subject"),
        body_text: z
          .string()
          .max(204800)
          .optional()
          .describe("Plain text body"),
        body_html: z
          .string()
          .max(512000)
          .optional()
          .describe("HTML body"),
        attachments: z
          .array(
            z.object({
              filename: z.string().max(255),
              content_type: z.string().max(255),
              content_base64: z.string(),
            }),
          )
          .max(20)
          .optional()
          .describe("File attachments (base64-encoded, max 25 MB total)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Save into a connected external account's Drafts (Gmail/Outlook/IMAP) instead of the mailbox"),
        identity_id: z.number().int().positive().optional().describe("From identity returned by list_identities"),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a fresh key is generated per call, so two identical calls save two drafts. Pass the same key to make a retry safe.",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ to, cc, bcc, subject, body_text, body_html, attachments, external_account_id, identity_id, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to save drafts (writes to the Drafts folder).",
        );
      }
      const body: Record<string, unknown> = {};
      if (to) body.to = to;
      if (cc) body.cc = cc;
      if (bcc) body.bcc = bcc;
      if (subject) body.subject = subject;
      if (body_text || body_html) {
        body.body = { text: body_text ?? null, html: body_html ?? null };
      }
      if (attachments) body.attachments = attachments;
      if (external_account_id) body.external_account_id = external_account_id;
      if (identity_id) body.identity_id = identity_id;
      return callApi(() => client.saveDraft(body, idempotency_key));
    },
  );

  server.registerTool(
    "update_draft",
    {
      title: "Update Draft",
      description:
        "Update an existing draft by IMAP UID. Deletes the old draft and appends a new one, so the draft gets a NEW uid — the response returns it, and the old one stops working.",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the existing draft to replace"),
        to: z.array(z.string().email()).max(10).optional(),
        cc: z.array(z.string().email()).max(10).optional(),
        bcc: z.array(z.string().email()).max(10).optional(),
        subject: z.string().max(998).optional(),
        body_text: z.string().max(204800).optional(),
        body_html: z.string().max(512000).optional(),
        attachments: z
          .array(
            z.object({
              filename: z.string().max(255),
              content_type: z.string().max(255),
              content_base64: z.string(),
            }),
          )
          .max(20)
          .optional(),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Update a draft in a connected external account's Drafts (Gmail/Outlook/IMAP) instead of the mailbox"),
        identity_id: z.number().int().positive().optional().describe("From identity returned by list_identities"),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a fresh key is generated per call, so re-applying earlier content really updates the draft. Pass the same key to make a retry safe.",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ uid, to, cc, bcc, subject, body_text, body_html, attachments, external_account_id, identity_id, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update drafts (replaces the existing draft).",
        );
      }
      const body: Record<string, unknown> = {};
      if (to) body.to = to;
      if (cc) body.cc = cc;
      if (bcc) body.bcc = bcc;
      if (subject) body.subject = subject;
      if (body_text || body_html) {
        body.body = { text: body_text ?? null, html: body_html ?? null };
      }
      if (attachments) body.attachments = attachments;
      if (external_account_id) body.external_account_id = external_account_id;
      if (identity_id) body.identity_id = identity_id;
      return callApi(() => client.updateDraft(uid, body, idempotency_key));
    },
  );

  // --- Spam / Ham ---

  server.registerTool(
    "report_spam",
    {
      title: "Report Spam",
      description:
        "Report a message as spam. Trains the anti-spam filter (Rspamd) and moves the message to the Junk folder. Returns whether Rspamd training succeeded.",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message to report as spam"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("Source IMAP folder (default: INBOX)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ uid, folder }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to report spam (moves message and trains the anti-spam filter).",
        );
      }
      return callApi(() => client.reportSpam(uid, { folder }));
    },
  );

  server.registerTool(
    "report_ham",
    {
      title: "Report Not Spam",
      description:
        "Report a message as not spam (ham). Trains the anti-spam filter (Rspamd) and moves the message to INBOX. Returns whether Rspamd training succeeded.",
      inputSchema: {
        uid: z
          .number()
          .int()
          .positive()
          .describe("IMAP UID of the message to report as not-spam"),
        folder: z
          .string()
          .max(255)
          .optional()
          .describe("Source IMAP folder (default: Junk)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ uid, folder }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to report ham (moves message and trains the anti-spam filter).",
        );
      }
      return callApi(() => client.reportHam(uid, { folder }));
    },
  );

  // --- Bulk Actions ---

  server.registerTool(
    "bulk_action",
    {
      title: "Bulk Message Action",
      description:
        "Perform an action on up to 50 messages at once. Actions: read, unread, star, unstar, delete, move, spam, notspam. The 'destination' parameter is required for 'move'.",
      inputSchema: {
        folder: z
          .string()
          .max(255)
          .describe("IMAP folder containing the messages"),
        uids: z
          .array(z.number().int().positive())
          .min(1)
          .max(50)
          .describe("Array of IMAP UIDs (max 50)"),
        action: z
          .enum(["read", "unread", "star", "unstar", "delete", "move", "spam", "notspam"])
          .describe("Action to perform on all messages"),
        destination: z
          .string()
          .max(255)
          .optional()
          .describe("Destination folder (required for 'move' action)"),
        external_account_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Act on a connected external account (Gmail/Outlook/IMAP) instead of the mailbox. Native actions only — spam/notspam train THIS server's filter and are rejected for external accounts (move to the provider's Junk folder instead)."),
      },
      annotations: { destructiveHint: true },
    },
    async ({ folder, uids, action, destination, external_account_id }) => {
      if (action === "delete" && !config.allowDestructive) {
        return errorResult(
          "Bulk delete is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable.",
        );
      }
      return callApi(() =>
        client.bulkAction({ folder, uids, action, destination, external_account_id }),
      );
    },
  );
}
