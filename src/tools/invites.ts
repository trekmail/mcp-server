import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult, LOCAL_PART_PATTERN, LOCAL_PART_RULE } from "./util.js";

export function registerInviteTools(
  server: McpServer,
  client: TrekMailClient,
  config?: { allowSending?: boolean; allowDestructive?: boolean },
): void {
  server.registerTool(
    "create_invite",
    {
      title: "Create Invite",
      description:
        "Create a setup invite for a mailbox. Sends an email to the recipient with a link to set their own password and complete mailbox setup. Storage defaults to the shared account pool, or the client's mailbox size where one is set; pass storage_allocation_mb to pre-allocate dedicated storage that the recipient inherits at redeem. In a domain under a White Label client storage limit (list_client_limits), that allocation must also fit in what the limit has left, or the call fails with client_storage_limit_exceeded.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to create the invite for"),
        local_part: z
          .string()
          .max(64)
          .regex(LOCAL_PART_PATTERN)
          .describe(`The local part of the email address (before the @). ${LOCAL_PART_RULE}`),
        recipient_email: z
          .string()
          .email()
          .max(255)
          .describe(
            "The recipient's existing email address where the invite will be sent",
          ),
        expires_in_hours: z
          .number()
          .int()
          .min(1)
          .max(720)
          .optional()
          .describe("Hours until the invite expires (1-720, default: 168, i.e. 7 days)"),
        storage_allocation_mb: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Optional dedicated storage allocation in MB (e.g. 5120 for 5 GB). Omit for shared pool. Pending dedicated invites count against the available pool until they are redeemed or expire. In a client's domains with a mailbox size, omitting it gives that size, and a larger one is refused (client_mailbox_size_exceeded); the client's max_mailboxes can refuse (client_mailbox_limit_reached).",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params.",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({
      domain_id,
      local_part,
      recipient_email,
      expires_in_hours,
      storage_allocation_mb,
      idempotency_key,
    }) => {
      // Creating an invite triggers an outbound email to recipient_email.
      // Gate by allowSending — semantically matches send_message.
      if (!config?.allowSending) {
        return errorResult(
          "Sending operations are disabled. Set TREKMAIL_ALLOW_SENDING=true to create invites (they trigger an outbound email to the recipient).",
        );
      }
      const idemKey = idempotencyKey(
        "create_invite",
        { domain_id, local_part, recipient_email, expires_in_hours, storage_allocation_mb },
        idempotency_key,
      );
      return callApi(() =>
        client.createInvite(
          { domain_id, local_part, recipient_email, expires_in_hours, storage_allocation_mb },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "create_invites_bulk",
    {
      title: "Create Invites (Bulk)",
      description:
        "Create multiple setup invites in a single request. Each item specifies a local_part and recipient_email, and may optionally override the target domain via domain_id (otherwise the batch domain_id is used) — so one call can invite people onto several of your domains. Items without storage_allocation_mb use the shared account pool, or the client's mailbox size where one is set. A dedicated storage_allocation_mb is checked per item, against what the earlier items left: an item that does not fit fails with storage_pool_exceeded, or with client_storage_limit_exceeded in a domain under a White Label client storage limit, and the other items still go out. Returns results for each item.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The default domain ID for invites. Items may override it with their own domain_id."),
        items: z
          .array(
            z.object({
              local_part: z
                .string()
                .max(64)
                .regex(LOCAL_PART_PATTERN)
                .describe(`The local part of the email address. ${LOCAL_PART_RULE}`),
              recipient_email: z
                .string()
                .email()
                .max(255)
                .describe("The recipient's existing email address"),
              domain_id: z
                .number()
                .int()
                .positive()
                .optional()
                .describe(
                  "Optional target domain ID for this recipient, overriding the batch-level domain_id. Must be one of your account's domains.",
                ),
              storage_allocation_mb: z
                .number()
                .int()
                .positive()
                .optional()
                .describe(
                  "Optional dedicated storage allocation in MB (e.g. 5120 for 5 GB). Omit for shared pool. Checked per item against what the earlier items left. In a client's domains with a mailbox size, an item without it gets that size, and a larger one fails (client_mailbox_size_exceeded); items past the client's max_mailboxes fail (client_mailbox_limit_reached).",
                ),
            }),
          )
          .min(1)
          .max(100)
          .describe("Array of invite items (1-100)"),
        expires_in_hours: z
          .number()
          .int()
          .min(1)
          .max(720)
          .optional()
          .describe("Hours until the invites expire (1-720, default: 168, i.e. 7 days)"),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params.",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, items, expires_in_hours, idempotency_key }) => {
      if (!config?.allowSending) {
        return errorResult(
          "Sending operations are disabled. Set TREKMAIL_ALLOW_SENDING=true to bulk-create invites (each triggers an outbound email to its recipient).",
        );
      }
      const idemKey = idempotencyKey(
        "create_invites_bulk",
        { domain_id, items, expires_in_hours },
        idempotency_key,
      );
      return callApi(() =>
        client.createInvitesBulk(
          { domain_id, items, expires_in_hours },
          idemKey,
        ),
      );
    },
  );

  const inviteId = z
    .number()
    .int()
    .positive()
    .describe("The invite_id returned by create_invite, create_invites_bulk or list_invites");

  server.registerTool(
    "list_invites",
    {
      title: "List Invites",
      description:
        "List open setup invites (pending and expired), newest first, with status, email delivery_status and expires_at; never setup links. Finds the invite_id for resend_invite or cancel_invite.",
      inputSchema: {
        domain_id: z.number().int().positive().optional().describe("Only invites on this domain"),
        status: z.enum(["pending", "expired"]).optional().describe("Omit for both"),
        page: z.number().int().positive().optional(),
        per_page: z.number().int().min(1).max(100).optional().describe("Default 50"),
      },
    },
    async ({ domain_id, status, page, per_page }) =>
      callApi(() => client.listInvites({ domain_id, status, page, per_page })),
  );

  server.registerTool(
    "get_invite",
    {
      title: "Get Invite",
      description:
        "Read one setup invite: status (pending, expired, used, canceled), email delivery_status, last_sent_at, expires_at and the address it creates. No setup link.",
      inputSchema: { invite_id: inviteId },
    },
    async ({ invite_id }) => callApi(() => client.getInvite(invite_id)),
  );

  server.registerTool(
    "resend_invite",
    {
      title: "Resend Invite",
      description:
        "Email a pending or expired setup invite again with a new link (returned as invite_url); the old link stops working and the expiry restarts. An expired invite is revived if the domain has room. Used or canceled invites are refused.",
      inputSchema: {
        invite_id: inviteId,
        idempotency_key: z
          .string()
          .max(255)
          .optional()
          .describe(
            "Optional. If omitted, a repeat within 24 hours returns the first result without emailing again; pass a new key to resend once more.",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ invite_id, idempotency_key }) => {
      if (!config?.allowSending) {
        return errorResult(
          "Sending operations are disabled. Set TREKMAIL_ALLOW_SENDING=true to resend invites (each resend emails the recipient).",
        );
      }
      const idemKey = idempotencyKey("resend_invite", { invite_id }, idempotency_key);
      return callApi(() => client.resendInvite(invite_id, idemKey));
    },
  );

  server.registerTool(
    "cancel_invite",
    {
      title: "Cancel Invite",
      description:
        "Cancel a pending setup invite: its link stops working and the mailbox name is free for a new invite at once. Repeating returns it unchanged; used or expired invites are refused.",
      inputSchema: {
        invite_id: inviteId,
        confirm_cancel: z.boolean().describe("Must be true after reviewing the invite"),
        idempotency_key: z
          .string()
          .max(255)
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params.",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ invite_id, confirm_cancel, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to cancel invites.",
        );
      }
      if (!confirm_cancel) return errorResult("Cancel not confirmed. Set confirm_cancel=true.");
      const idemKey = idempotencyKey("cancel_invite", { invite_id }, idempotency_key);
      return callApi(() => client.cancelInvite(invite_id, idemKey));
    },
  );
}
