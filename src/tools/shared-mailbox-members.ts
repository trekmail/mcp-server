import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerSharedMailboxMemberTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "list_shared_mailbox_members",
    {
      title: "List Shared Mailbox Members",
      description:
        "List all members of a shared (team) mailbox. Shows each member's membership id, the underlying user mailbox, email, and permissions: `can_read` (always true — all members can read) and `can_send` (whether the member may reply or send as the shared address). A shared mailbox is a normal mailbox whose type is `shared`; members are other user mailboxes in the same account. Use list_mailboxes to find mailbox IDs.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The shared mailbox ID to list members for"),
      },
    },
    async ({ mailbox_id }) => {
      return callApi(() => client.listSharedMailboxMembers(mailbox_id));
    },
  );

  server.registerTool(
    "add_shared_mailbox_member",
    {
      title: "Add Shared Mailbox Member",
      description:
        "Add a member to a shared (team) mailbox. All members can read incoming mail. Optionally grant `can_send` (default true) so the member may also reply or send as the shared address. The member must be an existing user mailbox in the same account, identified by its mailbox ID. Use list_mailboxes to find the member's mailbox ID.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The shared mailbox ID to add a member to"),
        member_mailbox_id: z
          .number()
          .int()
          .positive()
          .describe(
            "The mailbox ID of the user mailbox to add as a member. Must be another mailbox in the same account.",
          ),
        can_send: z
          .boolean()
          .optional()
          .describe(
            "Whether the member may send or reply as the shared mailbox address (default: true).",
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
    async ({ mailbox_id, member_mailbox_id, can_send, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to add shared mailbox members.",
        );
      }
      const idemKey = idempotencyKey(
        "add_shared_mailbox_member",
        { mailbox_id, member_mailbox_id, can_send },
        idempotency_key,
      );
      return callApi(() =>
        client.addSharedMailboxMember(
          mailbox_id,
          { member_mailbox_id, can_send },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "update_shared_mailbox_member",
    {
      title: "Update Shared Mailbox Member",
      description:
        "Update a shared mailbox member's send permission. Pass `can_send: true` to allow the member to send or reply as the shared address, or `false` to restrict them to read-only access. Optionally set `custom_label` — the member's personal name for the shared mailbox in their own webmail (pass an empty string to clear it). Pass the membership row id (the `id` from list_shared_mailbox_members), not the member's mailbox id.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The shared mailbox ID the member belongs to"),
        member_id: z
          .number()
          .int()
          .positive()
          .describe(
            "The membership row id (the `id` field from list_shared_mailbox_members), not the member's mailbox id",
          ),
        can_send: z
          .boolean()
          .describe(
            "Whether the member may send or reply as the shared mailbox address",
          ),
        custom_label: z
          .string()
          .max(120)
          .optional()
          .describe(
            "Optional per-member personal label: the name this member sees for the shared mailbox in their own webmail switcher (max 120 chars). Pass an empty string to clear it back to the default (the mailbox display name / address). Omit to leave the existing label unchanged.",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, member_id, can_send, custom_label }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update shared mailbox members.",
        );
      }
      return callApi(() =>
        client.updateSharedMailboxMember(mailbox_id, member_id, {
          can_send,
          ...(custom_label !== undefined ? { custom_label } : {}),
        }),
      );
    },
  );

  server.registerTool(
    "remove_shared_mailbox_member",
    {
      title: "Remove Shared Mailbox Member",
      description:
        "Remove a member from a shared (team) mailbox. Pass the membership row id (the `id` from list_shared_mailbox_members). The last remaining member cannot be removed (422 last_member). This does not delete the member's own user mailbox.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The shared mailbox ID the member belongs to"),
        member_id: z
          .number()
          .int()
          .positive()
          .describe(
            "The membership row id (the `id` field from list_shared_mailbox_members) to remove",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, member_id, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Shared mailbox member removal is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable.",
        );
      }
      const idemKey = idempotencyKey(
        "remove_shared_mailbox_member",
        { mailbox_id, member_id },
        idempotency_key,
      );
      return callApi(() =>
        client.removeSharedMailboxMember(mailbox_id, member_id, idemKey),
      );
    },
  );
}
