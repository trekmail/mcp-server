import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { callApi } from "./util.js";

export function registerSpamStatsTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "get_spam_metrics",
    {
      title: "Get Spam Metrics",
      description:
        "Get daily spam protection metrics for a domain. Shows inbound emails, spam caught, spam rejected, and clean emails per day.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to get spam metrics for"),
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Number of days to look back (default 30, max 90)"),
      },
    },
    async ({ domain_id, days }) => {
      return callApi(() => client.getSpamMetrics(domain_id, days));
    },
  );

  server.registerTool(
    "get_spam_summary",
    {
      title: "Get Spam Summary",
      description:
        "Get a summary of spam protection for a domain. Includes total inbound, spam rate, protection status, and top triggered filter rules.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to get spam summary for"),
        days: z
          .number()
          .int()
          .min(1)
          .max(90)
          .optional()
          .describe("Number of days to look back (default 30, max 90)"),
      },
    },
    async ({ domain_id, days }) => {
      return callApi(() => client.getSpamSummary(domain_id, days));
    },
  );
}
