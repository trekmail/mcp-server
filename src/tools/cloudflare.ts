import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerCloudflareTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "validate_cloudflare_token",
    {
      title: "Validate Cloudflare Token",
      description:
        "Check if a Cloudflare API token is valid and active. Does not verify DNS permissions — use connect to test write access.",
      inputSchema: {
        api_token: z
          .string()
          .min(1)
          .describe("The Cloudflare API token to validate"),
      },
      // Read-only: validates token via Cloudflare's /user/tokens/verify
      // (no mutation). destructiveHint removed during the 2026-05-28
      // safety-gate sweep (was misleading clients into prompting users
      // for confirmation on a pure read).
    },
    async ({ api_token }) => {
      return callApi(() => client.validateCloudflareToken(api_token));
    },
  );

  server.registerTool(
    "list_cloudflare_zones",
    {
      title: "List Cloudflare Zones",
      description:
        "List all DNS zones accessible to a Cloudflare token, matched against your TrekMail domains. Shows which domains can be set up automatically.",
      inputSchema: {
        api_token: z
          .string()
          .min(1)
          .describe("The Cloudflare API token"),
      },
    },
    async ({ api_token }) => {
      return callApi(() => client.listCloudflareZones(api_token));
    },
  );

  server.registerTool(
    "connect_cloudflare_domains",
    {
      title: "Connect Cloudflare Domains",
      description:
        "Connect one or more domains to Cloudflare. Creates new TrekMail domains if they don't exist yet, and links them to Cloudflare zones for automatic DNS setup.",
      inputSchema: {
        api_token: z
          .string()
          .min(1)
          .describe("The Cloudflare API token with DNS:Edit permission"),
        selected: z
          .array(
            z.object({
              zone_id: z.string().describe("Cloudflare zone ID"),
              zone_name: z.string().describe("Domain name (e.g. example.com)"),
              trekmail_domain_id: z
                .number()
                .int()
                .nullable()
                .describe("TrekMail domain ID if it already exists, or null to create new"),
            }),
          )
          .min(1)
          .max(50)
          .describe("Domains to connect"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ api_token, selected, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to connect Cloudflare domains (creates TrekMail domains + writes DNS records).",
        );
      }
      const idemKey = idempotencyKey(
        "cloudflare_connect",
        { zones: selected.map((s) => s.zone_name).sort() },
        idempotency_key,
      );
      return callApi(() =>
        client.connectCloudflareDomains(api_token, selected, idemKey),
      );
    },
  );

  server.registerTool(
    "preview_cloudflare_dns",
    {
      title: "Preview Cloudflare DNS Changes",
      description:
        "Preview what DNS records will be created, merged, or replaced for connected Cloudflare domains. Run this before apply to see what will change.",
      inputSchema: {
        domain_ids: z
          .array(z.number().int().positive())
          .min(1)
          .max(50)
          .describe("TrekMail domain IDs to preview DNS changes for"),
        included_records: z
          .record(z.array(z.string()))
          .optional()
          .describe(
            "Optional per-domain allowlist: map of domain_id to array of record IDs (e.g. 'mx_primary', 'spf_record') to preview. Omitted = preview all records.",
          ),
      },
      // Read-only: previewCloudflareDns calls Cloudflare's DNS-list API
      // and computes the diff in memory; no records mutated. Annotation
      // removed during the 2026-05-28 sweep.
    },
    async ({ domain_ids, included_records }) => {
      return callApi(() =>
        client.previewCloudflareDns(domain_ids, included_records),
      );
    },
  );

  server.registerTool(
    "apply_cloudflare_dns",
    {
      title: "Apply Cloudflare DNS Changes",
      description:
        "Apply DNS record changes via Cloudflare API. Creates MX, SPF, DKIM, DMARC records automatically. Use preview first to see what will change.",
      inputSchema: {
        domain_ids: z
          .array(z.number().int().positive())
          .min(1)
          .max(50)
          .describe("TrekMail domain IDs to apply DNS changes for"),
        confirmed_conflicts: z
          .record(z.array(z.string()))
          .optional()
          .describe(
            "Map of domain_id to array of record IDs to force-replace. Only needed when preview shows conflicts.",
          ),
        included_records: z
          .record(z.array(z.string()))
          .optional()
          .describe(
            "Optional per-domain allowlist: map of domain_id to array of record IDs (e.g. 'mx_primary', 'spf_record') to write. Records left out are skipped. Omitted = write all records.",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_ids, confirmed_conflicts, included_records, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to apply Cloudflare DNS changes (mutates live DNS records — MX, SPF, DKIM, DMARC).",
        );
      }
      const idemKey = idempotencyKey(
        "cloudflare_apply",
        { domain_ids: domain_ids.sort() },
        idempotency_key,
      );
      return callApi(() =>
        client.applyCloudflareDns(
          domain_ids,
          confirmed_conflicts,
          idemKey,
          included_records,
        ),
      );
    },
  );

  server.registerTool(
    "list_cloudflare_tokens",
    {
      title: "List Cloudflare Tokens",
      description:
        "List all saved Cloudflare API tokens for this account, with the number of connected domains for each.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.listCloudflareTokens());
    },
  );

  server.registerTool(
    "delete_cloudflare_token",
    {
      title: "Delete Cloudflare Token",
      description:
        "Delete a saved Cloudflare token and disconnect all domains using it. Domains remain in TrekMail but lose their Cloudflare connection.",
      annotations: {
        destructiveHint: true,
      },
      inputSchema: {
        token_id: z
          .number()
          .int()
          .positive()
          .describe("The Cloudflare token ID to delete"),
      },
    },
    async ({ token_id }) => {
      if (!config.allowDestructive) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable token deletion.",
            },
          ],
        };
      }
      return callApi(() => client.deleteCloudflareToken(token_id));
    },
  );
}
