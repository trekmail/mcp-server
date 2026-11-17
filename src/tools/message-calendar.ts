import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageCalendarTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "list_calendar_events",
    {
      title: "List Calendar Events",
      description: "List calendar events within a date range with cursor pagination.",
      inputSchema: {
        start: z.string().describe("Start date (ISO 8601)"),
        end: z.string().describe("End date (ISO 8601)"),
        per_page: z.number().int().min(1).max(200).optional().describe("Events per page (default 200)"),
        cursor: z.string().max(2048).optional().describe("Continuation cursor returned by the previous page"),
      },
    },
    async ({ start, end, per_page, cursor }) => {
      return callApi(() => client.listCalendarEvents({ start, end, per_page, cursor }));
    },
  );

  server.registerTool(
    "create_calendar_event",
    {
      title: "Create Calendar Event",
      description: "Create a new calendar event.",
      inputSchema: {
        title: z.string().max(255).describe("Event title"),
        description: z.string().max(5000).optional(),
        start_at: z.string().describe("Start datetime (ISO 8601)"),
        end_at: z.string().optional().describe("End datetime (ISO 8601, must be >= start_at)"),
        all_day: z.boolean().optional().describe("Whether this is an all-day event"),
        timezone: z.string().optional().describe("IANA timezone (e.g. Europe/Berlin) the start_at/end_at wall-clock times are in; stored as UTC. Omit for a floating event."),
        location: z.string().max(500).optional(),
        color: z.string().max(20).optional().describe("Color hex code (e.g. #6366f1)"),
        reminder_minutes: z.number().int().min(0).max(10080).optional().describe("Browser reminder in minutes before event"),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create calendar events.");
      }
      return callApi(() => client.createCalendarEvent(params));
    },
  );

  server.registerTool(
    "update_calendar_event",
    {
      title: "Update Calendar Event",
      description: "Update an existing calendar event.",
      inputSchema: {
        id: z.number().int().positive().describe("Event ID"),
        title: z.string().max(255).optional(),
        description: z.string().max(5000).optional(),
        start_at: z.string().optional(),
        end_at: z.string().optional(),
        all_day: z.boolean().optional(),
        timezone: z.string().optional().describe("IANA timezone (e.g. Europe/Berlin) the start_at/end_at wall-clock times are in; stored as UTC. Omit for a floating event."),
        location: z.string().max(500).optional(),
        color: z.string().max(20).optional(),
        reminder_minutes: z.number().int().min(0).max(10080).optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, ...rest }) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update calendar events.");
      }
      return callApi(() => client.updateCalendarEvent(id, rest));
    },
  );

  server.registerTool(
    "delete_calendar_event",
    {
      title: "Delete Calendar Event",
      description: "Delete a calendar event. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        id: z.number().int().positive().describe("Event ID"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      if (!config.allowDestructive) {
        return errorResult("Event deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
      }
      return callApi(() => client.deleteCalendarEvent(id));
    },
  );

  server.registerTool(
    "respond_to_invitation",
    {
      title: "Answer Meeting Invitation",
      description:
        "Accept, tentatively accept or decline a meeting invitation in the mailbox. The reply is a real email to the organizer from the invited address; on accept the event is saved in the calendar. Get uid, folder and the invitation attachment's index (ics_event with method REQUEST) from read_message. Needs confirm_send=true; counts against sending limits.",
      inputSchema: {
        uid: z.number().int().positive().describe("UID of the message that carries the invitation"),
        folder: z.string().max(255).optional().describe("Folder of that message (default INBOX)"),
        attachment_index: z
          .number()
          .int()
          .min(0)
          .describe("attachments[].index of the invitation from read_message"),
        response: z.enum(["accepted", "tentative", "declined"]).describe("The answer to send"),
        confirm_send: z.boolean().describe("Must be true: sends a real email"),
        idempotency_key: z.string().optional().describe("Optional; derived from the arguments if omitted"),
      },
    },
    async ({ uid, folder, attachment_index, response, confirm_send, idempotency_key }) => {
      if (!config.allowSending) {
        return errorResult(
          "Sending is disabled. Set TREKMAIL_ALLOW_SENDING=true to answer invitations: the answer is an email to the organizer.",
        );
      }
      if (!confirm_send) {
        return errorResult(
          "Answer not confirmed. Set confirm_send=true: this sends a real email to the organizer.",
        );
      }
      const key = idempotencyKey(
        "respond_to_invitation",
        { uid, folder: folder ?? "INBOX", attachment_index, response },
        idempotency_key,
      );
      return callApi(() =>
        client.respondToInvitation(uid, { folder, attachment_index, response }, key),
      );
    },
  );
}
