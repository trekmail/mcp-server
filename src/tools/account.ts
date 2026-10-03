import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { callApi, errorResult } from "./util.js";
import { operationIdempotencyKey } from "../idempotency.js";

export function registerAccountTools(
  server: McpServer,
  client: TrekMailClient,
  config?: { allowDestructive?: boolean },
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
        "Get account information including current plan, resource limits, feature flags, and usage counts. Includes new_mailbox_client_auth_mode only when app passwords and the platform default for new mailboxes are both enabled. Existing mailboxes keep their own mode; use update_account to change the default for future mailboxes.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.getAccount());
    },
  );

  server.registerTool(
    "update_account",
    {
      title: "Update Account New-Mailbox Default",
      description:
        "Set new_mailbox_client_auth_mode for mailboxes created from now on; existing mailboxes keep their own setting. 'app_password_only' requires app passwords in mail apps; 'password_or_app_password' also accepts the mailbox password. Requires mailboxes:write and the account owner's token or connector; every account member is refused with scope_blocked_by_membership. Returns 404 unless app passwords and the platform default for new mailboxes are both enabled. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        new_mailbox_client_auth_mode: z.enum(["app_password_only", "password_or_app_password"]),
        idempotency_key: z.string().optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ new_mailbox_client_auth_mode, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to change the account default for new mailboxes.");
      }
      const idemKey = operationIdempotencyKey("update_account", idempotency_key);
      return callApi(() => client.updateAccount({ new_mailbox_client_auth_mode }, idemKey));
    },
  );

  server.registerTool(
    "get_sending_limits",
    {
      title: "Get Sending Limits",
      description:
        "Today's sending allowance for the whole account, as the limit check sees it: the plan's numbers after trial or first-payment caps (`causes`), each domain still in its first-week warm-up with the dates its allowance steps up, what the first payment would change (`after_payment`), and today's account-wide usage including forwarded mail. Use it before a large send, or to explain a sending_limit_exceeded error. Allowances count recipients (To + Cc + Bcc) and renew at 00:00 UTC.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.getSendingLimits());
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
