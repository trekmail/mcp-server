import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerSharedMailboxLifecycleTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "create_shared_mailbox",
    {
      title: "Create Shared Mailbox",
      description:
        "Create a new shared (team) mailbox. The mailbox is created with type `shared` and the specified members are added immediately — all members can read; they can also send as the shared address by default. Optionally configure storage: leave `storage_shared` unset (or true) to draw from the account's shared storage pool, or set it to false and supply `storage_mb` for a dedicated allocation.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain to create the shared mailbox under"),
        local_part: z
          .string()
          .describe(
            "The local-part of the address (the part before @). e.g. `support` for support@yourdomain.com",
          ),
        display_name: z
          .string()
          .optional()
          .describe("Optional display name for the mailbox (e.g. 'Support Team')"),
        member_mailbox_ids: z
          .array(z.number().int().positive())
          .describe(
            "One or more mailbox IDs (user mailboxes in the same account) to add as initial members",
          ),
        storage_shared: z
          .boolean()
          .optional()
          .describe(
            "Whether to use the account's shared storage pool (default: true). Set to false and provide storage_mb for a dedicated allocation.",
          ),
        storage_mb: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Dedicated storage allocation in MB. Required when storage_shared is false.",
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
      domain_id,
      local_part,
      display_name,
      member_mailbox_ids,
      storage_shared,
      storage_mb,
      idempotency_key: explicitKey,
    }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create shared mailboxes.",
        );
      }
      const idemKey = idempotencyKey(
        "create_shared_mailbox",
        { domain_id, local_part, display_name, member_mailbox_ids, storage_shared, storage_mb },
        explicitKey,
      );
      return callApi(() =>
        client.createSharedMailbox(
          { domain_id, local_part, display_name, member_mailbox_ids, storage_shared, storage_mb },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "convert_mailbox_to_shared",
    {
      title: "Convert Mailbox to Shared",
      description:
        "Convert an existing regular mailbox into a shared (team) mailbox. The specified members are added immediately. IMPORTANT: this operation rotates the mailbox password and ends direct login for the original owner — the mailbox is henceforth accessed only through the members' accounts. Use list_mailboxes to find the mailbox ID.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The ID of the regular mailbox to convert to shared"),
        member_mailbox_ids: z
          .array(z.number().int().positive())
          .describe(
            "One or more mailbox IDs (user mailboxes in the same account) to add as initial members",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key to prevent duplicate conversion on retries",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, member_mailbox_ids, idempotency_key: explicitKey }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to convert mailboxes to shared.",
        );
      }
      const idemKey = idempotencyKey(
        "convert_mailbox_to_shared",
        { mailbox_id, member_mailbox_ids },
        explicitKey,
      );
      return callApi(() =>
        client.convertMailboxToShared(mailbox_id, { member_mailbox_ids }, idemKey),
      );
    },
  );

  server.registerTool(
    "convert_shared_mailbox_to_regular",
    {
      title: "Convert Shared Mailbox to Regular",
      description:
        "Convert a shared (team) mailbox back to a regular user mailbox. ALL existing members are removed and direct login is re-enabled using the supplied password. The password must be at least 12 characters and contain uppercase, lowercase, and at least one digit. Use list_mailboxes to find the mailbox ID.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The ID of the shared mailbox to convert to a regular mailbox"),
        password: z
          .string()
          .describe(
            "New sign-in password for the mailbox (min 12 chars, must contain upper, lower, and a digit)",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key to prevent duplicate conversion on retries",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, password, idempotency_key: explicitKey }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to convert shared mailboxes to regular.",
        );
      }
      const idemKey = idempotencyKey(
        "convert_shared_mailbox_to_regular",
        { mailbox_id },
        explicitKey,
      );
      return callApi(() =>
        client.convertSharedMailboxToRegular(mailbox_id, { password }, idemKey),
      );
    },
  );
}
