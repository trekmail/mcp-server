import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { callApi } from "./util.js";

/**
 * Buying, for an agent with no human in the loop.
 *
 * Every tool here follows the same two-call shape, which is the Machine
 * Payments Protocol's, not ours: call once WITHOUT a credential and the answer
 * is a 402 carrying the amount, currency and network id; mint a credential for
 * exactly that; call again WITH it. Never guess the amount — the first call is
 * how you learn it, and the price is only ever decided server-side.
 *
 * The credential differs by what is being bought, and the two are NOT
 * interchangeable:
 *
 *   - credits          → a shared payment token (spt_...). Single use: it is
 *                        consumed by its first charge, and a partial charge
 *                        burns the remainder.
 *   - plan / drive / WL → a Stripe PaymentMethod (pm_...). A shared payment
 *                        token cannot back a subscription at all.
 *
 * These existed only as REST endpoints until now, which meant an agent
 * connected over MCP — the way agents actually connect — could not buy
 * anything at all.
 */
export function registerMachinePaymentTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  const credential = z
    .string()
    .optional()
    .describe(
      'Payment credential from your wallet, as the full header value: Payment credential="<base64url JSON>". ' +
        "Omit on the first call to receive a 402 stating the exact amount to authorise.",
    );

  server.registerTool(
    "agent_buy_verifier_credits",
    {
      title: "Buy Verifier Credits (agent, no human)",
      description:
        "Top up email-verification credits by paying with a shared payment token. Call once without " +
        "a credential to get a 402 with the exact amount, then again with a token minted for that " +
        "amount. Quantity must be one of the published tiers. Credits work on every plan.",
      inputSchema: {
        quantity: z
          .number()
          .int()
          .describe("Credit bundle size. Must match a published tier — read /ai-agents/offer.json."),
        currency: z
          .string()
          .length(3)
          .optional()
          .describe("ISO currency. Defaults to the account currency."),
        credential,
      },
    },
    async ({ quantity, currency, credential: cred }) => {
      return callApi(() => client.agentTopUpCredits(quantity, cred, currency));
    },
  );

  server.registerTool(
    "agent_subscribe_mail_plan",
    {
      title: "Subscribe to a Mail Plan (agent, no human)",
      description:
        "Start a mail-plan subscription using a Stripe PaymentMethod (NOT a shared payment token — " +
        "those cannot back recurring billing). Only pro and agency can be bought this way: lower " +
        "plans grant no permission to add domains or create mailboxes, so the purchase would be " +
        "unusable. Full price, with no trial, discount or proration. After buying, call " +
        "agent_reissue_key so your key matches the plan.",
      inputSchema: {
        plan: z.string().describe("Plan slug: pro or agency."),
        period: z.enum(["monthly", "yearly"]).describe("Billing period."),
        credential,
      },
    },
    async ({ plan, period, credential: cred }) => {
      return callApi(() => client.agentSubscribePlan(plan, period, cred));
    },
  );

  server.registerTool(
    "agent_subscribe_drive_addon",
    {
      title: "Buy Drive Storage (agent, no human)",
      description:
        "Start a Drive storage add-on subscription with a Stripe PaymentMethod. Sold on its own — no " +
        "mail plan needed. Size must be one of the published steps; read /ai-agents/offer.json for the " +
        "ladder and prices.",
      inputSchema: {
        size_gb: z.number().int().describe("Storage size in GB. Must be a published step."),
        period: z.enum(["monthly", "yearly"]).describe("Billing period."),
        credential,
      },
    },
    async ({ size_gb, period, credential: cred }) => {
      return callApi(() => client.agentSubscribeDriveAddon(size_gb, period, cred));
    },
  );

  server.registerTool(
    "agent_subscribe_white_label",
    {
      title: "Buy White Label (agent, no human)",
      description:
        "Start a White Label subscription with a Stripe PaymentMethod. Its own subscription; no mail " +
        "plan required.",
      inputSchema: {
        period: z.enum(["monthly", "yearly"]).describe("Billing period."),
        credential,
      },
    },
    async ({ period, credential: cred }) => {
      return callApi(() => client.agentSubscribeWhiteLabel(period, cred));
    },
  );

  server.registerTool(
    "agent_reissue_key",
    {
      title: "Re-issue Your Own Key After Buying (agent, no human)",
      description:
        "Exchange your key for one scoped to the plan the account now holds. Buying entitles the " +
        "ACCOUNT, not the key that bought it, so without this you will keep getting 403 on domains " +
        "and mailboxes after a successful purchase. Returns the new key ONCE and revokes the old " +
        "one immediately. Only works for a key issued through agent signup — a connector authorised " +
        "by a human must be re-authorised by that human instead.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.agentReissueKey());
    },
  );
}
