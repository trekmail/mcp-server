import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

/**
 * Per-domain Branding / White Label Lite tools. An agent can configure a
 * domain's brand end-to-end:
 *   set_domain_branding → get_domain_branding (read remaining DNS actions, and
 *   mail_zone.records and the verified DAV URL when the mail zone is on) →
 *   apply_cloudflare_dns (existing DNS tools) → verify_domain_branding_dns →
 *   poll get_domain_branding until hosts are active → create_branding_preview.
 *
 * Convention parity with the sibling domain features (signature / SMTP):
 * the read tool carries no annotations; every mutating tool is
 * destructiveHint + gated behind TREKMAIL_ALLOW_DESTRUCTIVE.
 */
export function registerBrandingTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  const hexColor = z
    .string()
    .regex(
      /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
      "Must be a 3, 4, 6, or 8 digit CSS hex color like #4f46e5",
    );
  const dnsLabel = z
    .string()
    .max(63)
    .regex(/^(?!-)[a-z0-9-]+(?<!-)$/i, "DNS-label safe: letters, digits, hyphens");

  const destructiveDisabled = (verb: string) =>
    errorResult(
      `Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to ${verb}.`,
    );

  server.registerTool(
    "get_domain_branding",
    {
      title: "Get Domain Branding",
      description:
        "Read the per-domain White Label branding state: mode (off/inherit/custom), brand identity, mail-zone DNS/client-host status, verified DAV URL and certificate expiry, dashboard/webmail hosts, add-on state, and only the DNS records that still need attention. Create returned records with the Cloudflare DNS tools, then poll until client_hosts_status is 'active' and dav_ready is true.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID to read branding for"),
      },
    },
    async ({ domain_id }) => callApi(() => client.getDomainBranding(domain_id)),
  );

  server.registerTool(
    "set_domain_branding",
    {
      title: "Set Domain Branding",
      description:
        "Configure White Label branding for a domain. PARTIAL update — only the fields you pass change; omit a field to leave it unchanged. mode=custom uses a domain-specific brand, mode=inherit uses the account default, mode=off disables branding. Set dashboard_enabled/webmail_enabled to claim branded URLs, and mail_zone_enabled to brand the DNS zone plus IMAP/SMTP client hostnames. This tool is available only while White Label is active. scope=domain (default) saves for this domain only; scope=account_default also makes it the account default for new domains; scope=all rolls this pattern out to every existing domain. After saving, call get_domain_branding to inspect DNS and provisioning state. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID to brand"),
        mode: z
          .enum(["off", "inherit", "custom"])
          .optional()
          .describe("Branding mode (defaults to the domain's current mode)"),
        name: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("Brand name shown in dashboard, webmail, and emails"),
        primary_color: hexColor
          .optional()
          .describe("Primary brand color (buttons, links, active states)"),
        accent_color: hexColor
          .optional()
          .describe("Accent color (highlights, compose button)"),
        dashboard_enabled: z
          .boolean()
          .optional()
          .describe("Enable a branded dashboard URL for this domain"),
        dashboard_label: dnsLabel
          .optional()
          .describe("Subdomain label for the dashboard host (default 'dashboard')"),
        webmail_enabled: z
          .boolean()
          .optional()
          .describe("Enable a branded webmail URL for this domain"),
        webmail_label: dnsLabel
          .optional()
          .describe("Subdomain label for the webmail host (default 'mail')"),
        mail_zone_enabled: z
          .boolean()
          .optional()
          .describe(
            "Serve mail apps under the brand's own domain (imap./smtp./dav.<domain>). Belongs to the brand, so it needs mode=custom or scope=account_default. Read any remaining DNS actions, the safe DAV URL, and provisioning status from get_domain_branding under mail_zone",
          ),
        support_email: z
          .string()
          .email()
          .max(255)
          .nullable()
          .optional()
          .describe("Support email shown in branded emails (pass null to clear)"),
        sender_email: z
          .string()
          .email()
          .max(255)
          .nullable()
          .optional()
          .describe(
            "From address for transactional emails — must be a DKIM-verified domain on this account (pass null to clear)",
          ),
        support_url: z
          .string()
          .url()
          .max(500)
          .nullable()
          .optional()
          .describe("Help-center URL linked in email footers (pass null to clear)"),
        scope: z
          .enum(["domain", "account_default", "all"])
          .optional()
          .describe("Apply scope (default 'domain')"),
        idempotency_key: z.string().max(255).optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("configure branding");
      }
      const { domain_id, idempotency_key, ...rest } = args;
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) {
          body[key] = value;
        }
      }
      const idemKey = idempotencyKey("set_domain_branding", { domain_id, ...body }, idempotency_key);
      return callApi(() => client.setDomainBranding(domain_id, body, idemKey));
    },
  );

  server.registerTool(
    "set_domain_brand_logo",
    {
      title: "Set Domain Brand Logo",
      description:
        "Upload a brand asset for a domain, base64-encoded. slot=light is the logo for light backgrounds, slot=dark for dark backgrounds, slot=favicon is the browser-tab icon. content_base64 is the raw image bytes base64-encoded — PNG or JPG (favicon also accepts ICO), max 1 MB; SVG is not supported. Configure branding (set_domain_branding) before uploading. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        slot: z
          .enum(["light", "dark", "favicon"])
          .describe("Which asset to set"),
        content_base64: z
          .string()
          .max(1_402_200)
          .describe("Base64-encoded image bytes (PNG/JPG, ≤1 MB)"),
        idempotency_key: z.string().max(255).optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, slot, content_base64, idempotency_key }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("set a brand logo");
      }
      const idemKey = idempotencyKey(
        "set_domain_brand_logo",
        { domain_id, slot, content_base64 },
        idempotency_key,
      );
      return callApi(() => client.setDomainBrandLogo(domain_id, slot, content_base64, idemKey));
    },
  );

  server.registerTool(
    "verify_domain_branding_dns",
    {
      title: "Verify Domain Branding DNS",
      description:
        "Queue a DNS check + SSL provisioning for this domain's enabled branded hosts, and re-check the brand's mail zone if it has one. Run after the CNAME records (from get_domain_branding) resolve. Requires the White Label add-on — without it returns white_label_inactive. Hosts move draft/pending_dns → active once DNS resolves and the certificate is issued; poll get_domain_branding for status, including mail_zone.dns_status and mail_zone.client_hosts_status. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        idempotency_key: z.string().max(255).optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, idempotency_key }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("verify branding DNS");
      }
      const idemKey = idempotencyKey("verify_domain_branding_dns", { domain_id }, idempotency_key);
      return callApi(() => client.verifyDomainBrandingDns(domain_id, idemKey));
    },
  );

  server.registerTool(
    "create_branding_preview",
    {
      title: "Create Branding Preview",
      description:
        "Mint a one-time preview link that shows the account dashboard under this domain's active White Label brand on a temporary preview host. The link signs the owner in once and expires quickly. Returns { url, expires_in }. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID with a saved brand"),
        idempotency_key: z.string().max(255).optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, idempotency_key }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("create a branding preview");
      }
      const idemKey = idempotencyKey("create_branding_preview", { domain_id }, idempotency_key);
      return callApi(() => client.createBrandingPreview(domain_id, idemKey));
    },
  );

  server.registerTool(
    "remove_domain_brand_logo",
    {
      title: "Remove Domain Brand Logo",
      description:
        "Remove a brand asset (slot=light/dark/favicon) from a domain's brand. The saved file is deleted. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        slot: z
          .enum(["light", "dark", "favicon"])
          .describe("Which asset to remove"),
        idempotency_key: z.string().max(255).optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, slot, idempotency_key }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("remove a brand asset");
      }
      const idemKey = idempotencyKey("remove_domain_brand_logo", { domain_id, slot }, idempotency_key);
      return callApi(() => client.removeDomainBrandLogo(domain_id, slot, idemKey));
    },
  );

  server.registerTool(
    "remove_domain_branding",
    {
      title: "Remove Domain Branding",
      description:
        "Turn off White Label branding. scope=domain (default) turns it off for this domain only; scope=all turns it off for EVERY domain in the account — branded URLs stop serving. Saved brand assets are kept as drafts and can be re-enabled later. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
        scope: z
          .enum(["domain", "all"])
          .optional()
          .describe("Removal scope (default 'domain')"),
        idempotency_key: z.string().max(255).optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, scope, idempotency_key }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("remove branding");
      }
      const idemKey = idempotencyKey("remove_domain_branding", { domain_id, scope }, idempotency_key);
      return callApi(() => client.removeDomainBranding(domain_id, scope, idemKey));
    },
  );
}
