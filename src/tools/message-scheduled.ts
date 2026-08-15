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
        scheduled_for: z
          .string()
          .describe(
            "ISO 8601 datetime for delivery (must be in the future). If you include a UTC offset (Z or ±HH:MM) it is authoritative. If the value has no offset, the `timezone` argument decides interpretation; without it the value is treated as UTC.",
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            "Optional IANA timezone name (e.g. 'America/New_York'). Only consulted when `scheduled_for` lacks an explicit offset; the server then interprets the naïve datetime in this zone before storing as UTC. Pass this whenever the user speaks in local time.",
          ),
        external_account_id: z.number().int().positive().optional().describe("Connected inbox used for sending"),
        identity_id: z.number().int().positive().optional().describe("From identity returned by list_identities"),
        confirm_send: z.boolean().describe("Must be true to schedule"),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ to, cc, bcc, subject, body_text, body_html, scheduled_for, timezone, external_account_id, identity_id, confirm_send, idempotency_key: idemKey }) => {
      if (!config.allowSending) {
        return errorResult("Sending is disabled. Set TREKMAIL_ALLOW_SENDING=true to enable.");
      }
      if (!confirm_send) {
        return errorResult("Schedule not confirmed. Set confirm_send=true.");
      }
      const body: Record<string, unknown> = { to, scheduled_for };
      if (timezone) body.timezone = timezone;
      if (cc) body.cc = cc;
      if (bcc) body.bcc = bcc;
      if (subject) body.subject = subject;
      if (body_text || body_html) body.body = { text: body_text ?? null, html: body_html ?? null };
      if (external_account_id) body.external_account_id = external_account_id;
      if (identity_id) body.identity_id = identity_id;
      const key = idempotencyKey("schedule_message", { to, subject, scheduled_for, timezone, external_account_id, identity_id }, idemKey);
      return callApi(() => client.scheduleMessage(body, key));
    },
  );

  server.registerTool(
    "list_scheduled",
    {
      title: "List Scheduled Messages",
      description:
        "List pending scheduled messages for the mailbox with cursor pagination. Pass next_cursor from pagination to retrieve every result.",
      inputSchema: {
        cursor: z.string().max(2048).optional().describe("Opaque next_cursor from the previous page"),
        per_page: z.number().int().min(1).max(100).optional().describe("Results per page (default 100)"),
      },
    },
    async ({ cursor, per_page }) => {
      return callApi(() => client.listScheduled({ cursor, per_page }));
    },
  );

  server.registerTool(
    "reschedule_message",
    {
      title: "Reschedule Pending Message",
      description:
        "Change the delivery time of a pending scheduled message without re-sending. Use this instead of cancel + schedule when the user only wants to move the send time — it does not consume a messages:send rate-limit slot.",
      inputSchema: {
        id: z
          .number()
          .int()
          .positive()
          .describe("ID of the pending scheduled message to re-time."),
        scheduled_for: z
          .string()
          .describe(
            "New ISO 8601 datetime. If you include a UTC offset (Z or ±HH:MM) it is authoritative. If naïve, the `timezone` argument decides interpretation; without it the value is treated as UTC.",
          ),
        timezone: z
          .string()
          .optional()
          .describe(
            "Optional IANA timezone (e.g. 'America/New_York'). Only consulted when `scheduled_for` lacks an explicit offset.",
          ),
      },
      // Not marked destructiveHint — moves a pending row, never sends or
      // deletes data.
    },
    async ({ id, scheduled_for, timezone }) => {
      if (!config.allowSending) {
        return errorResult("Sending is disabled. Set TREKMAIL_ALLOW_SENDING=true to enable.");
      }
      const body: Record<string, unknown> = { scheduled_for };
      if (timezone) body.timezone = timezone;
      return callApi(() => client.rescheduleMessage(id, body));
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
