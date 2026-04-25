import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi } from "./util.js";

export function registerAutoReplyTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "get_auto_reply",
    {
      title: "Get Auto-Reply",
      description:
        "Get the vacation auto-reply settings for a mailbox. Shows whether auto-reply is enabled, the subject, message body, and date range.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
      },
    },
    async ({ mailbox_id }) => {
      return callApi(() => client.getAutoReply(mailbox_id));
    },
  );

  server.registerTool(
    "set_auto_reply",
    {
      title: "Set Auto-Reply",
      description:
        "Configure the vacation auto-reply for a mailbox. Set a custom subject, message body, optional date range, and whether to skip mailing lists. Each sender receives the reply at most once every 7 days. Starter, Pro, and Agency plans.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
        enabled: z.boolean().describe("Whether auto-reply should be active"),
        subject: z
          .string()
          .max(500)
          .optional()
          .describe("Reply subject line. Required when enabled=true."),
        body: z
          .string()
          .max(5000)
          .optional()
          .describe("Reply message body. Required when enabled=true."),
        start_date: z
          .string()
          .optional()
          .describe("Start date (YYYY-MM-DD). Optional — if omitted, active immediately."),
        end_date: z
          .string()
          .optional()
          .describe("End date (YYYY-MM-DD). Optional — if omitted, active until disabled."),
        skip_lists: z
          .boolean()
          .default(true)
          .describe("Skip mailing lists and automated messages (default: true)"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
    },
    async (inputs) => {
      const idemKey = idempotencyKey(
        "set_auto_reply",
        { mailbox_id: inputs.mailbox_id, enabled: inputs.enabled },
        inputs.idempotency_key,
      );
      return callApi(() =>
        client.setAutoReply(
          inputs.mailbox_id,
          {
            enabled: inputs.enabled,
            subject: inputs.subject,
            body: inputs.body,
            start_date: inputs.start_date,
            end_date: inputs.end_date,
            skip_lists: inputs.skip_lists,
          },
          idemKey,
        ),
      );
    },
  );
}
