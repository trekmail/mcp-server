import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi } from "./util.js";

export function registerTicketTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "list_tickets",
    {
      title: "List Tickets",
      description:
        "List support tickets on the TrekMail account. Supports filtering by status and category. Returns paginated results.",
      inputSchema: {
        status: z
          .enum(["open", "waiting_customer", "closed"])
          .optional()
          .describe("Filter by ticket status"),
        category: z
          .enum([
            "billing",
            "technical",
            "account",
            "deliverability",
            "api",
            "abuse",
            "feature",
            "partnership",
            "sales",
            "affiliate",
            "other",
          ])
          .optional()
          .describe("Filter by ticket category"),
        page: z.number().int().positive().optional().describe("Page number"),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Results per page (1-100)"),
      },
    },
    async ({ status, category, page, per_page }) => {
      return callApi(() =>
        client.listTickets({ status, category, page, per_page }),
      );
    },
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Get Ticket",
      description:
        "Get detailed information about a specific support ticket, including its status and metadata.",
      inputSchema: {
        ticket_id: z
          .number()
          .int()
          .positive()
          .describe("The ticket ID to retrieve"),
      },
    },
    async ({ ticket_id }) => {
      return callApi(() => client.getTicket(ticket_id));
    },
  );

  server.registerTool(
    "get_ticket_messages",
    {
      title: "Get Ticket Messages",
      description:
        "Get all messages in a support ticket conversation, ordered chronologically.",
      inputSchema: {
        ticket_id: z
          .number()
          .int()
          .positive()
          .describe("The ticket ID"),
      },
    },
    async ({ ticket_id }) => {
      return callApi(() => client.getTicketMessages(ticket_id));
    },
  );

  server.registerTool(
    "create_ticket",
    {
      title: "Create Ticket",
      description:
        "Create a new support ticket. Requires a subject, category, and initial message.",
      inputSchema: {
        subject: z
          .string()
          .min(4)
          .max(150)
          .describe("The ticket subject (4-150 characters)"),
        category: z
          .enum([
            "billing",
            "technical",
            "account",
            "deliverability",
            "api",
            "abuse",
            "feature",
            "partnership",
            "sales",
            "affiliate",
            "other",
          ])
          .describe("The ticket category"),
        message: z
          .string()
          .min(5)
          .max(5000)
          .describe("The initial message body (5-5000 characters)"),
        priority: z
          .enum(["normal", "high", "urgent"])
          .optional()
          .describe("Ticket priority (defaults to normal)"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
    },
    async ({ subject, category, message, priority, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "create_ticket",
        { subject, category, message, priority },
        idempotency_key,
      );
      return callApi(() =>
        client.createTicket({ subject, category, message, priority }, idemKey),
      );
    },
  );

  server.registerTool(
    "reply_to_ticket",
    {
      title: "Reply to Ticket",
      description:
        "Reply to an existing support ticket. Cannot reply to closed tickets.",
      inputSchema: {
        ticket_id: z
          .number()
          .int()
          .positive()
          .describe("The ticket ID to reply to"),
        message: z
          .string()
          .min(5)
          .max(5000)
          .describe("The reply message body (5-5000 characters)"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
    },
    async ({ ticket_id, message, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "reply_to_ticket",
        { ticket_id, message },
        idempotency_key,
      );
      return callApi(() =>
        client.replyToTicket(ticket_id, message, idemKey),
      );
    },
  );

  server.registerTool(
    "close_ticket",
    {
      title: "Close Ticket",
      description:
        "Close a support ticket. Cannot close an already-closed ticket.",
      inputSchema: {
        ticket_id: z
          .number()
          .int()
          .positive()
          .describe("The ticket ID to close"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
    },
    async ({ ticket_id, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "close_ticket",
        { ticket_id },
        idempotency_key,
      );
      return callApi(() => client.closeTicket(ticket_id, idemKey));
    },
  );
}
