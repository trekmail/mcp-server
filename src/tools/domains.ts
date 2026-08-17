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
        "Add a new domain to the account. The domain will start in pending_dns status. DNS records must be configured before it becomes active. Pass mail_hosting='external' when the customer keeps incoming mail at their current provider: no MX record is asked for, the domain hosts no mailboxes, and it is used only as a verified From address.",
      inputSchema: {
        name: z
          .string()
          .max(255)
          .describe(
            "The domain name to add (e.g. 'example.com'). Must be lowercase.",
          ),
        mail_hosting: z
          .enum(["trekmail", "external"])
          .optional()
          .describe(
            "Where incoming mail lives. Default 'trekmail' (we host the mailboxes); 'external' keeps it with the customer's provider and uses the domain for sending only.",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ name, mail_hosting, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create domains.",
        );
      }
      const idemKey = idempotencyKey(
        "create_domain",
        { name, mail_hosting },
        idempotency_key,
      );
      return callApi(() => client.createDomain(name, idemKey, mail_hosting));
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

  // ── Forwarding addresses ──────────────────────────────────────────────
  // Mailbox-less forwards on a domain. Deliberately separate tools from
  // update_domain_catch_all: catch-all sweeps everything unmatched to one
  // place, these are the named addresses an agency actually maintains.

  server.registerTool(
    "list_forwarding_addresses",
    {
      title: "List Forwarding Addresses",
      description:
        "List mailbox-less forwarding addresses on a domain, with each address's recipients, whether it is paused, the per-domain limit, and whether the account's plan currently delivers them.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ domain_id }) => callApi(() => client.listForwardingAddresses(domain_id)),
  );

  server.registerTool(
    "get_forwarding_address_log",
    {
      title: "Get Forwarding Address Delivery Log",
      description:
        "Recent deliveries for one forwarding address: when each message came in, who sent it, where it was forwarded, and the outcome — delivered, deferred, rejected by the recipient, or blocked as spam before forwarding. The window is the plan's retention (30 days on Agency, 7 otherwise); nothing older is kept.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        forwarding_address_id: z
          .number()
          .int()
          .positive()
          .describe("The forwarding address ID"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("How many events to return, newest first (default 100)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ domain_id, forwarding_address_id, limit }) =>
      callApi(() =>
        client.getForwardingAddressLog(domain_id, forwarding_address_id, limit),
      ),
  );

  server.registerTool(
    "create_forwarding_address",
    {
      title: "Create Forwarding Address",
      description:
        "Create a forwarding address on a domain: mail to it is handed straight on to the recipients and nothing is stored. No mailbox is created. Delivery requires the Agency plan; on other plans the rule is saved and starts working after an upgrade.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        local_part: z
          .string()
          .min(1)
          .max(64)
          .describe("Part before the @, e.g. \"sales\""),
        recipients: z
          .array(z.string().email())
          .min(1)
          .describe("Where mail to this address is delivered"),
        is_active: z
          .boolean()
          .optional()
          .describe("Create it paused by passing false (default true)"),
        idempotency_key: z.string().optional(),
      },
    },
    async ({ domain_id, local_part, recipients, is_active, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "create_forwarding_address",
        { domain_id, local_part },
        idempotency_key,
      );
      return callApi(() =>
        client.createForwardingAddress(
          domain_id,
          local_part,
          recipients,
          is_active ?? true,
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "update_forwarding_address",
    {
      title: "Update Forwarding Address",
      description:
        "Replace the recipients of a forwarding address, pause it, or resume it. Pausing keeps the configuration and bounces mail meanwhile.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        forwarding_address_id: z
          .number()
          .int()
          .positive()
          .describe("The forwarding address ID"),
        recipients: z
          .array(z.string().email())
          .min(1)
          .optional()
          .describe("Replaces the existing recipients entirely"),
        is_active: z
          .boolean()
          .optional()
          .describe("false pauses the address, true resumes it"),
      },
    },
    async ({ domain_id, forwarding_address_id, recipients, is_active }) => {
      if (recipients === undefined && is_active === undefined) {
        return errorResult(
          "Nothing to update: pass recipients, is_active, or both.",
        );
      }
      const body: { recipients?: string[]; is_active?: boolean } = {};
      if (recipients !== undefined) body.recipients = recipients;
      if (is_active !== undefined) body.is_active = is_active;
      return callApi(() =>
        client.updateForwardingAddress(domain_id, forwarding_address_id, body),
      );
    },
  );

  server.registerTool(
    "delete_forwarding_address",
    {
      title: "Delete Forwarding Address",
      description:
        "Delete a forwarding address. Mail sent to it bounces from then on — pause it instead to stop delivery temporarily.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        forwarding_address_id: z
          .number()
          .int()
          .positive()
          .describe("The forwarding address ID"),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, forwarding_address_id, idempotency_key }) => {
      // Same guard as delete_alias: an agent running with default safety must
      // not be able to remove mail routing for an address.
      if (!config?.allowDestructive) {
        return errorResult(
          "Forwarding address deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable. Pause the address instead to stop delivery reversibly.",
        );
      }
      const idemKey = idempotencyKey(
        "delete_forwarding_address",
        { domain_id, forwarding_address_id },
        idempotency_key,
      );
      return callApi(() =>
        client.deleteForwardingAddress(domain_id, forwarding_address_id, idemKey),
      );
    },
  );

  server.registerTool(
    "set_domain_mail_hosting",
    {
      title: "Set Where Domain Mail Is Hosted",
      description:
        "Choose whether TrekMail hosts this domain's incoming mail or the customer keeps it with their current provider. 'external' asks for no MX record, allows no mailboxes, catch-all or forwarding on the domain, and uses it only as a verified From address — the forwarded-copy workflow. Switching an existing domain to 'external' stops its mailboxes receiving; nothing is deleted and switching back restores delivery.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        mail_hosting: z
          .enum(["trekmail", "external"])
          .describe(
            "'trekmail' = we host the mailboxes; 'external' = incoming mail stays with the customer's provider",
          ),
        confirm_mailboxes_stop_receiving: z
          .boolean()
          .optional()
          .describe(
            "Required only when moving to 'external' while the domain still holds mailboxes",
          ),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, mail_hosting, confirm_mailboxes_stop_receiving }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to change where a domain's mail is hosted (moving to 'external' stops its mailboxes receiving).",
        );
      }
      return callApi(() =>
        client.updateDomainMailHosting(
          domain_id,
          mail_hosting,
          confirm_mailboxes_stop_receiving,
        ),
      );
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
    "get_domain_signature",
    {
      title: "Get Domain Signature",
      description:
        "Get the per-domain email signature settings (mode, position, html). Returns mode='off' when no signature is configured.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to read the signature for"),
      },
    },
    async ({ domain_id }) => {
      return callApi(() => client.getDomainSignature(domain_id));
    },
  );

  server.registerTool(
    "update_domain_signature",
    {
      title: "Update Domain Signature",
      description:
        "Set the per-domain email signature. mode=off disables; mode=default seeds newly-created mailbox identities; mode=enforced overrides per-mailbox signatures on the webmail compose path. signature_html accepts safe HTML (up to 10000 chars); unsafe tags are stripped.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to update"),
        signature_mode: z
          .enum(["off", "default", "enforced"])
          .describe("How the signature is applied for this domain"),
        signature_position: z
          .enum(["before_reply", "after_reply"])
          .optional()
          .describe(
            "Where to render the signature in reply emails (default: before_reply)",
          ),
        signature_html: z
          .string()
          .max(10000)
          .optional()
          .describe("Signature HTML (sanitised server-side)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, signature_mode, signature_position, signature_html }) => {
      if (!config?.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update the domain signature.",
        );
      }
      return callApi(() =>
        client.updateDomainSignature(domain_id, {
          signature_mode,
          signature_position,
          signature_html: signature_html ?? null,
        }),
      );
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
