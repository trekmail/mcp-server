import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi } from "./util.js";

export function registerDnsTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "get_dns_requirements",
    {
      title: "Get DNS Requirements",
      description:
        "Get the DNS records that need to be configured for a domain. Returns MX, SPF, DKIM, and DMARC requirements.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to get DNS requirements for"),
      },
    },
    async ({ domain_id }) => {
      return callApi(() => client.getDnsRequirements(domain_id));
    },
  );

  server.registerTool(
    "dns_recheck",
    {
      title: "DNS Recheck",
      description:
        "Trigger an asynchronous DNS verification check for a domain. Returns a check ID that can be polled with get_dns_check.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to recheck DNS for"),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Optional idempotency key. If omitted, a deterministic key is generated from the params.",
          ),
      },
    },
    async ({ domain_id, idempotency_key }) => {
      // Use 5-minute time buckets so repeated rechecks generate new keys
      // (DNS rechecks are meant to be repeated, unlike create operations)
      const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
      const idemKey = idempotencyKey(
        "dns_recheck",
        { domain_id, _t: timeBucket },
        idempotency_key,
      );
      return callApi(() => client.dnsRecheck(domain_id, idemKey));
    },
  );

  server.registerTool(
    "get_dns_check",
    {
      title: "Get DNS Check",
      description:
        "Get the status and results of a DNS verification check. Poll this after triggering dns_recheck.",
      inputSchema: {
        check_id: z
          .number()
          .int()
          .positive()
          .describe("The DNS check ID to retrieve"),
      },
    },
    async ({ check_id }) => {
      return callApi(() => client.getDnsCheck(check_id));
    },
  );
}
