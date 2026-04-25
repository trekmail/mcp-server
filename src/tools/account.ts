import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { callApi } from "./util.js";

export function registerAccountTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "whoami",
    {
      title: "Who Am I",
      description:
        "Verify the current API token and return token details (name, scopes, expiry) and account info.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.getMe());
    },
  );

  server.registerTool(
    "get_account",
    {
      title: "Get Account",
      description:
        "Get account information including current plan, resource limits, feature flags, and usage counts.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.getAccount());
    },
  );

  server.registerTool(
    "get_billing_status",
    {
      title: "Get Billing Status",
      description:
        "Get the current billing status including plan, subscription state, renewal/trial/cancellation dates, and provider.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.getBillingStatus());
    },
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List Invoices",
      description:
        "List billing invoices for the account. Returns invoice details including amounts, status, and download URLs.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.listInvoices());
    },
  );
}
