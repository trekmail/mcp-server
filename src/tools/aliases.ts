import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerAliasTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "list_aliases",
    {
      title: "List Aliases",
      description:
        "List all email aliases for a mailbox. Shows each alias address, receiving/sending status, and whether it's active. Also returns the primary address and usage limits (used/max).",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to list aliases for"),
      },
    },
    async ({ mailbox_id }) => {
      return callApi(() => client.listAliases(mailbox_id));
    },
  );

  server.registerTool(
    "create_alias",
    {
      title: "Create Alias",
      description:
        "Add a new email alias to a mailbox. The alias delivers mail into the same mailbox — no separate login needed. Optionally allow sending from this alias address. Requires Starter plan or above. Use list_domains to find domain IDs.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to add an alias to"),
        local_part: z
          .string()
          .max(64)
          .regex(/^[a-z0-9._-]+$/)
          .describe(
            "The local part of the alias (before @). Lowercase letters, digits, dots, hyphens, underscores only.",
          ),
        domain_id: z
          .number()
          .int()
          .positive()
          .describe(
            "The domain ID for the alias. Can be any active domain on the account.",
          ),
        can_receive: z
          .boolean()
          .default(true)
          .describe(
            "Whether the alias should receive incoming mail (default: true)",
          ),
        can_send: z
          .boolean()
          .default(false)
          .describe(
            "Whether the mailbox owner can send emails from this alias address (default: false)",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key to prevent duplicate creation on retries",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({
      mailbox_id,
      local_part,
      domain_id,
      can_receive,
      can_send,
      idempotency_key,
    }) => {
      const idemKey = idempotencyKey(
        "create_alias",
        { mailbox_id, local_part, domain_id },
        idempotency_key,
      );
      return callApi(() =>
        client.createAlias(
          mailbox_id,
          { local_part, domain_id, can_receive, can_send },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "update_alias",
    {
      title: "Update Alias",
      description:
        "Update an alias — toggle receiving, sending, or active/inactive status. Cannot change the alias address itself — delete and recreate instead.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID the alias belongs to"),
        alias_id: z
          .number()
          .int()
          .positive()
          .describe("The alias ID to update"),
        can_receive: z
          .boolean()
          .optional()
          .describe("Whether the alias should receive incoming mail"),
        can_send: z
          .boolean()
          .optional()
          .describe(
            "Whether the mailbox owner can send from this alias",
          ),
        is_active: z
          .boolean()
          .optional()
          .describe(
            "Whether the alias is active (false = disabled, stops receiving and sending)",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, alias_id, can_receive, can_send, is_active }) => {
      return callApi(() =>
        client.updateAlias(mailbox_id, alias_id, {
          can_receive,
          can_send,
          is_active,
        }),
      );
    },
  );

  server.registerTool(
    "delete_alias",
    {
      title: "Delete Alias",
      description:
        "Permanently remove an email alias from a mailbox. Mail sent to this address will no longer be delivered. This cannot be undone.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID the alias belongs to"),
        alias_id: z
          .number()
          .int()
          .positive()
          .describe("The alias ID to delete"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, alias_id, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Alias deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable.",
        );
      }
      const idemKey = idempotencyKey(
        "delete_alias",
        { mailbox_id, alias_id },
        idempotency_key,
      );
      return callApi(() => client.deleteAlias(mailbox_id, alias_id, idemKey));
    },
  );
}
