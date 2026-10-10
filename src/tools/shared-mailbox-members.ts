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
        "List reachable members of a shared (team) mailbox within the caller's domain and mailbox limits. Delegated dashboard roles need shared_mailboxes:read in addition to the mailboxes:read API grant. Shows each member's membership id, the underlying user mailbox, email, and permissions: `can_read` (opens the shared inbox and, when enabled, a shared IMAP folder), `can_send` (Send as), and `access` (read_send, read_only or send_only). Send-only members send from their own webmail or mail app with no access to the team inbox. The Message API does not support delegated sending yet. In mail apps, members sign in with their own address and app password; no shared password exists. Use list_mailboxes to find mailbox IDs.",
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
        "Add a member to a shared (team) mailbox. Delegated dashboard roles need shared_mailboxes:write in addition to the mailboxes:write API grant; both mailboxes must be within the caller's domain and mailbox limits. Read (`can_read`) and Send as (`can_send`) both default to true. Set can_read=false and can_send=true for send-only access while the feature is enabled and another active reader remains. The API refuses no_access_left, send_only_disabled or last_reader with 422. Send-only members use webmail or a mail app; the Message API cannot send as their team address yet. For readers, use get_mail_client_setup with the member mailbox ID to wait for native_access_ready and verify effective send_as_ready plus exact folder paths.",
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
        can_read: z
          .boolean()
          .optional()
          .describe("Whether the member can open the shared inbox (default: true). False requires send-only access to be enabled and another active reader."),
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
    async ({ mailbox_id, member_mailbox_id, can_read, can_send, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to add shared mailbox members.",
        );
      }
      const idemKey = idempotencyKey(
        "add_shared_mailbox_member",
        { mailbox_id, member_mailbox_id, can_read, can_send },
        idempotency_key,
      );
      return callApi(() =>
        client.addSharedMailboxMember(
          mailbox_id,
          { member_mailbox_id, can_read, can_send },
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
        "Delegated dashboard roles need shared_mailboxes:write in addition to the mailboxes:write API grant; both mailboxes must be within the caller's domain and mailbox limits. Update a shared mailbox member's Read (`can_read`) and Send as (`can_send`) permissions independently; omitted fields stay unchanged. At least one of can_read, can_send or custom_label is required. Both permissions cannot be false (422 no_access_left); send-only access requires the feature (send_only_disabled) and another active reader (last_reader). Send-only members use webmail or a mail app, with no team inbox access or Message API sending. Optionally set `custom_label`, the member's personal name for the shared mailbox in their own Webmail (pass an empty string to clear it). A retryable `native_access_sync_failed` means no permission change was saved. Pass the membership row id from list_shared_mailbox_members, not the member mailbox id.",
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
        can_read: z
          .boolean()
          .optional()
          .describe("Whether the member can open the shared inbox. Omit to keep current Read access."),
        can_send: z
          .boolean()
          .optional()
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
    async ({ mailbox_id, member_id, can_read, can_send, custom_label }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update shared mailbox members.",
        );
      }
      return callApi(() =>
        client.updateSharedMailboxMember(mailbox_id, member_id, {
          ...(can_read !== undefined ? { can_read } : {}),
          ...(can_send !== undefined ? { can_send } : {}),
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
        "Delegated dashboard roles need shared_mailboxes:write in addition to the mailboxes:write API grant; both mailboxes must be within the caller's domain and mailbox limits. Remove a member from a shared (team) mailbox, revoking Read and Send as access without deleting the member's own mailbox. The last active reader cannot be removed (422 last_reader when send-only members remain; last_member for the legacy case). A retryable `native_access_sync_failed` keeps the membership. Pass the membership row id from list_shared_mailbox_members.",
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
