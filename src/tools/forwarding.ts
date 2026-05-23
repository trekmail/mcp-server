import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi } from "./util.js";

export function registerForwardingTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "get_forwarding",
    {
      title: "Get Forwarding",
      description:
        "Get the current forwarding configuration for a mailbox. Shows whether forwarding is enabled, the target addresses, and keep-copy setting.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to get forwarding config for"),
      },
    },
    async ({ mailbox_id }) => {
      return callApi(() => client.getForwarding(mailbox_id));
    },
  );

  server.registerTool(
    "set_forwarding",
    {
      title: "Set Forwarding",
      description:
        "Configure email forwarding for a mailbox. Set targets, enable/disable forwarding, and choose whether to keep a copy in the original mailbox.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to configure forwarding for"),
        enabled: z
          .boolean()
          .describe("Whether forwarding should be enabled"),
        targets: z
          .array(z.string().email())
          .max(1)
          .optional()
          .describe("Email address to forward to (exactly 1). Required when enabled=true, omit when disabling."),
        keep_copy: z
          .boolean()
          .default(true)
          .describe(
            "Whether to keep a copy of forwarded emails in the original mailbox (default: true)",
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
    async ({ mailbox_id, enabled, targets, keep_copy, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "set_forwarding",
        { mailbox_id, enabled, targets, keep_copy },
        idempotency_key,
      );
      return callApi(() =>
        client.setForwarding(
          mailbox_id,
          { enabled, targets, keep_copy },
          idemKey,
        ),
      );
    },
  );
}
