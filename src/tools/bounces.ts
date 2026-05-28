import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { callApi } from "./util.js";

export function registerBounceTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "get_domain_deliverability",
    {
      title: "Get Domain Deliverability Summary",
      description:
        "Get the outbound deliverability rollup for a domain — sent, delivered, soft/hard bounce counts, delivery rate, bounce rate, and health status (good/warning/poor). Mirrors the stats cards on the domain detail page.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to get deliverability stats for"),
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
      return callApi(() => client.getDomainDeliverability(domain_id, days));
    },
  );

  const bounceListInput = {
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("Number of days to look back (default 30, max 90)"),
    type: z
      .enum(["hard", "soft", "all"])
      .optional()
      .describe("Filter by bounce type: hard, soft, or all (default all)"),
    recipient: z
      .string()
      .max(255)
      .optional()
      .describe("Filter by recipient email (partial, case-insensitive match)"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Results per page (default 50, max 100)"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Skip this many results for pagination (default 0)"),
  };

  server.registerTool(
    "list_domain_bounces",
    {
      title: "List Domain Outbound Bounces",
      description:
        "List recent per-recipient hard/soft bounces for outbound mail sent from a domain. Each result includes the SMTP status code and the receiver's response, so you can diagnose exactly why specific messages failed (mailbox full, policy reject, bad recipient, etc.). RFC1918 IPs are masked in the response field.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to list bounces for"),
        ...bounceListInput,
      },
    },
    async ({ domain_id, days, type, recipient, limit, offset }) => {
      return callApi(() =>
        client.listDomainBounces(domain_id, {
          days,
          type,
          recipient,
          limit,
          offset,
        }),
      );
    },
  );

  server.registerTool(
    "list_mailbox_bounces",
    {
      title: "List Mailbox Outbound Bounces",
      description:
        "Same as list_domain_bounces but scoped to a single mailbox — useful for per-sender reputation triage. Returns per-recipient SMTP failures.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to list bounces for"),
        ...bounceListInput,
      },
    },
    async ({ mailbox_id, days, type, recipient, limit, offset }) => {
      return callApi(() =>
        client.listMailboxBounces(mailbox_id, {
          days,
          type,
          recipient,
          limit,
          offset,
        }),
      );
    },
  );
}
