import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
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
      description: "List calendar events within a date range (max 200 events).",
      inputSchema: {
        start: z.string().describe("Start date (ISO 8601)"),
        end: z.string().describe("End date (ISO 8601)"),
      },
    },
    async ({ start, end }) => {
      return callApi(() => client.listCalendarEvents({ start, end }));
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
        location: z.string().max(500).optional(),
        color: z.string().max(20).optional().describe("Color hex code (e.g. #6366f1)"),
        reminder_minutes: z.number().int().min(0).max(10080).optional().describe("Reminder in minutes before event"),
        reminder_type: z.enum(["notification", "email"]).optional(),
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
        location: z.string().max(500).optional(),
        color: z.string().max(20).optional(),
        reminder_minutes: z.number().int().min(0).max(10080).optional(),
        reminder_type: z.enum(["notification", "email"]).optional(),
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
}
