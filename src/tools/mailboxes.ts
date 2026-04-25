import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerMailboxTools(
  server: McpServer,
  client: TrekMailClient,
  config?: { allowDestructive?: boolean },
): void {
  server.registerTool(
    "list_mailboxes",
    {
      title: "List Mailboxes",
      description:
        "List mailboxes on the TrekMail account. Supports filtering by domain and searching by address. Returns paginated results.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Filter mailboxes by domain ID"),
        search: z
          .string()
          .max(255)
          .optional()
          .describe("Search mailboxes by address"),
        page: z.number().int().positive().optional().describe("Page number"),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page (1-100)"),
      },
    },
    async ({ domain_id, search, page, per_page }) => {
      return callApi(() =>
        client.listMailboxes({ domain_id, search, page, per_page }),
      );
    },
  );

  server.registerTool(
    "get_mailbox",
    {
      title: "Get Mailbox",
      description:
        "Get detailed information about a specific mailbox including its status, forwarding config, and domain.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to retrieve"),
      },
    },
    async ({ mailbox_id }) => {
      return callApi(() => client.getMailbox(mailbox_id));
    },
  );

  server.registerTool(
    "create_mailbox_generated_password",
    {
      title: "Create Mailbox",
      description:
        "Create a new mailbox with an auto-generated one-time password. The password is returned once and must be saved immediately — it cannot be retrieved later.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to create the mailbox on"),
        local_part: z
          .string()
          .max(64)
          .regex(/^[a-z0-9._-]+$/)
          .describe(
            "The local part of the email address (before the @). E.g. 'alice' for alice@example.com. Lowercase letters, digits, dots, hyphens, underscores only.",
          ),
        display_name: z
          .string()
          .max(255)
          .optional()
          .describe("Optional display name for the mailbox"),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params to prevent duplicates on retries.",
          ),
      },
    },
    async ({ domain_id, local_part, display_name, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "create_mailbox_generated_password",
        { domain_id, local_part, display_name },
        idempotency_key,
      );
      return callApi(() =>
        client.createMailboxGeneratedPassword(
          { domain_id, local_part, display_name },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "change_mailbox_password",
    {
      title: "Change Mailbox Password",
      description:
        "Change the password of a mailbox. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true because password changes are irreversible.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
        password: z
          .string()
          .min(12)
          .describe(
            "New password (min 12 chars, must contain uppercase, lowercase, and numeric)",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, password, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Password change is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable.",
        );
      }
      const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
      const idemKey = idempotencyKey(
        "change_mailbox_password",
        { mailbox_id, _t: timeBucket },
        idempotency_key,
      );
      return callApi(() =>
        client.changeMailboxPassword(mailbox_id, password, idemKey),
      );
    },
  );

  server.registerTool(
    "update_mailbox_note",
    {
      title: "Update Mailbox Note",
      description:
        "Update the note/description on a mailbox (max 120 characters). Pass null to clear.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
        note: z
          .string()
          .max(120)
          .nullable()
          .describe("The note text (max 120 chars) or null to clear"),
      },
    },
    async ({ mailbox_id, note }) => {
      return callApi(() => client.updateMailboxNote(mailbox_id, note));
    },
  );

  server.registerTool(
    "pause_mailbox",
    {
      title: "Pause Mailbox",
      description:
        "Pause (disable) a mailbox. The mailbox will stop receiving and sending email until resumed.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to pause"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
    },
    async ({ mailbox_id, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Pausing mailboxes is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable (pausing stops all email delivery).",
        );
      }
      const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
      const idemKey = idempotencyKey(
        "pause_mailbox",
        { mailbox_id, _t: timeBucket },
        idempotency_key,
      );
      return callApi(() => client.pauseMailbox(mailbox_id, idemKey));
    },
  );

  server.registerTool(
    "resume_mailbox",
    {
      title: "Resume Mailbox",
      description:
        "Resume a paused (disabled) mailbox. The mailbox will start receiving and sending email again.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to resume"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
    },
    async ({ mailbox_id, idempotency_key }) => {
      const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
      const idemKey = idempotencyKey(
        "resume_mailbox",
        { mailbox_id, _t: timeBucket },
        idempotency_key,
      );
      return callApi(() => client.resumeMailbox(mailbox_id, idemKey));
    },
  );

  server.registerTool(
    "bulk_create_mailboxes",
    {
      title: "Bulk Create Mailboxes",
      description:
        "Create multiple mailboxes at once (1-100). Each item specifies a domain and local part. Returns per-item results with status codes (200 created, 207 partial success, 422 all failed).",
      inputSchema: {
        items: z
          .array(
            z.object({
              domain_id: z
                .number()
                .int()
                .positive()
                .describe("The domain ID to create the mailbox on"),
              local_part: z
                .string()
                .max(64)
                .regex(/^[a-z0-9._-]+$/)
                .describe("Local part of the email address (before the @)"),
              password: z
                .string()
                .min(12)
                .optional()
                .describe(
                  "Optional password. If omitted, a one-time password is generated and returned.",
                ),
            }),
          )
          .min(1)
          .max(100)
          .describe("Array of mailboxes to create (1-100 items)"),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated.",
          ),
      },
    },
    async ({ items, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "bulk_create_mailboxes",
        { count: items.length, first: items[0]?.local_part },
        idempotency_key,
      );
      return callApi(() => client.bulkCreateMailboxes(items, idemKey));
    },
  );

  server.registerTool(
    "enable_imap",
    {
      title: "Enable IMAP Access",
      description:
        "Enable IMAP access for a mailbox so message tokens can be created. Requires the current mailbox password.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
        password: z
          .string()
          .describe("The current mailbox password"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
    },
    async ({ mailbox_id, password, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "enable_imap",
        { mailbox_id },
        idempotency_key,
      );
      return callApi(() =>
        client.enableImap(mailbox_id, password, idemKey),
      );
    },
  );
}
