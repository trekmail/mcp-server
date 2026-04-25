import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageScheduledTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "schedule_message",
    {
      title: "Schedule Message",
      description:
        "Schedule an email to be sent at a future date/time. Requires TREKMAIL_ALLOW_SENDING=true and confirm_send=true.",
      inputSchema: {
        to: z.array(z.string().email()).min(1).max(10).describe("Recipient emails"),
        cc: z.array(z.string().email()).max(10).optional(),
        bcc: z.array(z.string().email()).max(10).optional(),
        subject: z.string().max(998).optional(),
        body_text: z.string().max(204800).optional(),
        body_html: z.string().max(512000).optional(),
        scheduled_for: z.string().describe("ISO 8601 datetime for delivery (must be in the future)"),
        confirm_send: z.boolean().describe("Must be true to schedule"),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ to, cc, bcc, subject, body_text, body_html, scheduled_for, confirm_send, idempotency_key: idemKey }) => {
      if (!config.allowSending) {
        return errorResult("Sending is disabled. Set TREKMAIL_ALLOW_SENDING=true to enable.");
      }
      if (!confirm_send) {
        return errorResult("Schedule not confirmed. Set confirm_send=true.");
      }
      const body: Record<string, unknown> = { to, scheduled_for };
      if (cc) body.cc = cc;
      if (bcc) body.bcc = bcc;
      if (subject) body.subject = subject;
      if (body_text || body_html) body.body = { text: body_text ?? null, html: body_html ?? null };
      const key = idempotencyKey("schedule_message", { to, subject, scheduled_for }, idemKey);
      return callApi(() => client.scheduleMessage(body, key));
    },
  );

  server.registerTool(
    "list_scheduled",
    {
      title: "List Scheduled Messages",
      description: "List pending scheduled messages for the mailbox.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.listScheduled());
    },
  );

  server.registerTool(
    "cancel_scheduled",
    {
      title: "Cancel Scheduled Message",
      description: "Cancel a pending scheduled message. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        id: z.number().int().positive().describe("ID of the scheduled message to cancel"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      if (!config.allowDestructive) {
        return errorResult("Cancellation is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
      }
      return callApi(() => client.cancelScheduled(id));
    },
  );
}
