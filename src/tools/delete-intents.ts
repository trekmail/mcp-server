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
        "Confirm a delete intent to permanently delete a mailbox. This is step 2 of the two-step deletion process. IRREVERSIBLE — the mailbox and all its data will be permanently destroyed. Both TREKMAIL_ALLOW_DESTRUCTIVE=true and confirm=true are required.",
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
          "Deletion not confirmed. Set confirm=true to permanently delete the mailbox. This action is IRREVERSIBLE.",
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
}
