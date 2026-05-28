import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerDomainTools(
  server: McpServer,
  client: TrekMailClient,
  config?: Config,
): void {
  server.registerTool(
    "list_domains",
    {
      title: "List Domains",
      description:
        "List domains on the TrekMail account. Supports filtering by status and searching by name. Returns paginated results.",
      inputSchema: {
        status: z
          .enum(["pending_dns", "active", "suspended"])
          .optional()
          .describe("Filter by domain status"),
        search: z.string().max(255).optional().describe("Search domains by name"),
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
    async ({ status, search, page, per_page }) => {
      return callApi(() =>
        client.listDomains({ status, search, page, per_page }),
      );
    },
  );

  server.registerTool(
    "get_domain",
    {
      title: "Get Domain",
      description:
        "Get detailed information about a specific domain, including its verification status and configuration.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to retrieve"),
      },
    },
    async ({ domain_id }) => {
      return callApi(() => client.getDomain(domain_id));
    },
  );

  server.registerTool(
    "create_domain",
    {
      title: "Create Domain",
      description:
        "Add a new domain to the account. The domain will start in pending_dns status. DNS records must be configured before it becomes active.",
      inputSchema: {
        name: z
          .string()
          .max(255)
          .describe(
            "The domain name to add (e.g. 'example.com'). Must be lowercase.",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ name, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create domains.",
        );
      }
      const idemKey = idempotencyKey(
        "create_domain",
        { name },
        idempotency_key,
      );
      return callApi(() => client.createDomain(name, idemKey));
    },
  );

  server.registerTool(
    "delete_domain",
    {
      title: "Delete Domain",
      description:
        "Permanently delete a domain and all its mailboxes. This action is irreversible. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to delete"),
        confirm_delete: z
          .boolean()
          .describe("Must be true to confirm deletion"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, confirm_delete, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Domain deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable.",
        );
      }
      if (!confirm_delete) {
        return errorResult(
          "Deletion not confirmed. Set confirm_delete=true to proceed.",
        );
      }
      const idemKey = idempotencyKey(
        "delete_domain",
        { domain_id },
        idempotency_key,
      );
      return callApi(() => client.deleteDomain(domain_id, idemKey));
    },
  );

  server.registerTool(
    "update_domain_catch_all",
    {
      title: "Update Domain Catch-All",
      description:
        "Configure catch-all email forwarding for a domain. Unmatched emails will be forwarded to the destination. Internal targets (mailboxes on the same domain) work on all plans. External targets require Pro or Agency plan.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID"),
        enabled: z.boolean().describe("Whether catch-all is enabled"),
        destination: z
          .string()
          .email()
          .max(255)
          .optional()
          .describe(
            "Destination email address (required when enabled=true)",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, enabled, destination }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to change domain catch-all (intercepts all unmatched mail to a single destination).",
        );
      }
      if (enabled && !destination) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "destination is required when enabled=true",
              }),
            },
          ],
          isError: true,
        };
      }
      return callApi(() =>
        client.updateDomainCatchAll(domain_id, enabled, destination),
      );
    },
  );

  server.registerTool(
    "retry_domain_dkim",
    {
      title: "Retry Domain DKIM",
      description:
        "Restart DKIM key provisioning for a domain. Use this if DKIM provisioning failed or needs to be regenerated.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to retry DKIM provisioning (regenerates keys and updates DNS).",
        );
      }
      const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
      const idemKey = idempotencyKey(
        "retry_domain_dkim",
        { domain_id, _t: timeBucket },
        idempotency_key,
      );
      return callApi(() => client.retryDomainDkim(domain_id, idemKey));
    },
  );

  server.registerTool(
    "update_domain_note",
    {
      title: "Update Domain Note",
      description:
        "Update the note/description on a domain (max 120 characters). Pass null to clear.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID"),
        note: z
          .string()
          .max(120)
          .nullable()
          .describe("The note text (max 120 chars) or null to clear"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, note }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update domain notes.",
        );
      }
      return callApi(() => client.updateDomainNote(domain_id, note));
    },
  );

  server.registerTool(
    "bulk_add_domains",
    {
      title: "Bulk Add Domains",
      description:
        "Add multiple domains at once (up to 20). Returns per-domain results with success/error status.",
      inputSchema: {
        domains: z
          .array(z.string().max(255))
          .min(1)
          .max(20)
          .describe("Array of domain names to add"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domains, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to bulk-add domains.",
        );
      }
      const idemKey = idempotencyKey(
        "bulk_add_domains",
        { domains },
        idempotency_key,
      );
      return callApi(() => client.bulkAddDomains(domains, idemKey));
    },
  );
}
