import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerInviteTools(
  server: McpServer,
  client: TrekMailClient,
  config?: { allowSending?: boolean },
): void {
  server.registerTool(
    "create_invite",
    {
      title: "Create Invite",
      description:
        "Create a setup invite for a mailbox. Sends an email to the recipient with a link to set their own password and complete mailbox setup. Storage defaults to the shared account pool; pass storage_allocation_mb to pre-allocate dedicated storage that the recipient inherits at redeem.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to create the invite for"),
        local_part: z
          .string()
          .max(64)
          .regex(/^[a-z0-9._-]+$/)
          .describe("The local part of the email address (before the @). Lowercase letters, digits, dots, hyphens, underscores only."),
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
          .describe("Hours until the invite expires (1-720, default: 72)"),
        storage_allocation_mb: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "Optional dedicated storage allocation in MB (e.g. 5120 for 5 GB). Omit for shared pool. Pending dedicated invites count against the available pool until they are redeemed or expire.",
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
        "Create multiple setup invites in a single request. Each item specifies a local_part and recipient_email. Returns results for each item.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to create invites for"),
        items: z
          .array(
            z.object({
              local_part: z
                .string()
                .max(64)
                .regex(/^[a-z0-9._-]+$/)
                .describe("The local part of the email address. Lowercase letters, digits, dots, hyphens, underscores only."),
              recipient_email: z
                .string()
                .email()
                .max(255)
                .describe("The recipient's existing email address"),
              storage_allocation_mb: z
                .number()
                .int()
                .positive()
                .optional()
                .describe(
                  "Optional dedicated storage allocation in MB (e.g. 5120 for 5 GB). Omit for shared pool. Sum across all items is validated against the available pool.",
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
          .describe("Hours until the invites expire (1-720, default: 72)"),
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
}
