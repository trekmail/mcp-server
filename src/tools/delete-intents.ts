import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerDeleteIntentTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "create_delete_intent",
    {
      title: "Create Delete Intent",
      description:
        "Create a delete intent for a mailbox. This is step 1 of the two-step deletion process. Returns an intent with a confirmation token that expires in 5 minutes. The intent must be confirmed with confirm_delete_intent to proceed.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to create a delete intent for"),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params.",
          ),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ mailbox_id, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable mailbox deletion via the MCP server.",
        );
      }

      const idemKey = idempotencyKey(
        "create_delete_intent",
        { mailbox_id },
        idempotency_key,
      );
      return callApi(() =>
        client.createDeleteIntent(mailbox_id, idemKey),
      );
    },
  );

  server.registerTool(
    "confirm_delete_intent",
    {
      title: "Confirm Delete Intent",
      description:
        "Confirm a delete intent to delete a mailbox. This is step 2 of the two-step deletion process. The mailbox is moved to the recycle bin and can be restored within the retention window (default 7 days) with restore_mailbox; after that window it is permanently purged. Both TREKMAIL_ALLOW_DESTRUCTIVE=true and confirm=true are required.",
      inputSchema: {
        intent_id: z
          .number()
          .int()
          .positive()
          .describe("The delete intent ID to confirm"),
        confirm: z
          .boolean()
          .describe(
            "Must be true to confirm deletion. This is a safety gate to prevent accidental deletion.",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params.",
          ),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ intent_id, confirm, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable mailbox deletion via the MCP server.",
        );
      }

      if (!confirm) {
        return errorResult(
          "Deletion not confirmed. Set confirm=true to move the mailbox to the recycle bin (restorable for the retention window with restore_mailbox).",
        );
      }

      const idemKey = idempotencyKey(
        "confirm_delete_intent",
        { intent_id },
        idempotency_key,
      );
      return callApi(() =>
        client.confirmDeleteIntent(intent_id, idemKey),
      );
    },
  );

  server.registerTool(
    "restore_mailbox",
    {
      title: "Restore Mailbox",
      description:
        "Restore a mailbox from the recycle bin back to active. Use list_trashed_mailboxes to find trashed mailbox IDs. Fails (422) if the domain is now at its mailbox limit.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The trashed mailbox ID to restore"),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params.",
          ),
      },
      annotations: {
        idempotentHint: true,
      },
    },
    async ({ mailbox_id, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "restore_mailbox",
        { mailbox_id },
        idempotency_key,
      );
      return callApi(() => client.restoreMailbox(mailbox_id, idemKey));
    },
  );

  server.registerTool(
    "list_trashed_mailboxes",
    {
      title: "List Trashed Mailboxes",
      description:
        "List mailboxes currently in the recycle bin (soft-deleted, restorable). Each is permanently purged after its retention window elapses. Use restore_mailbox to recover one.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional: only list trashed mailboxes on this domain"),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page (1-100, default 50)"),
      },
      annotations: {
        readOnlyHint: true,
      },
    },
    async ({ domain_id, per_page }) => {
      return callApi(() =>
        client.listMailboxes({ status: "trashed", domain_id, per_page }),
      );
    },
  );
}
