import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { callApi, errorResult } from "./util.js";

/**
 * Per-domain Branding / White Label Lite tools. An agent can configure a
 * domain's brand end-to-end:
 *   set_domain_branding → get_domain_branding (read required CNAMEs) →
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
    .regex(/^#[0-9a-fA-F]{3,8}$/, "Must be a hex color like #4f46e5");
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
        "Read the per-domain White Label branding state: mode (off/inherit/custom), brand identity (name, colors, logo/favicon URLs, support + sender email), the dashboard/webmail hosts with provisioning status, the White Label add-on flag, and the CNAME records that must exist for the branded hosts to go live. Use it to discover which DNS records to create (then add them via the Cloudflare DNS tools) and to poll host status until 'active'.",
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
        "Configure White Label branding for a domain. PARTIAL update — only the fields you pass change; omit a field to leave it unchanged. mode=custom uses a domain-specific brand, mode=inherit uses the account default, mode=off disables branding (defaults to the current mode if omitted — but if branding is currently off you must pass mode to re-enable it). Set dashboard_enabled/webmail_enabled to claim branded URLs at label.domain (e.g. dashboard.acme.com, mail.acme.com). Branding always saves; branded URLs only go live (pending_dns → active) once the White Label add-on is active — without it they stay drafts. scope=domain (default) saves for this domain only; scope=account_default also makes it the account default for new domains; scope=all rolls this pattern out to every existing domain. After saving, call get_domain_branding to read the CNAMEs, create them, then verify_domain_branding_dns. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
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
      },
      annotations: { destructiveHint: true },
    },
    async (args) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("configure branding");
      }
      const { domain_id, ...rest } = args;
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) {
          body[key] = value;
        }
      }
      return callApi(() => client.setDomainBranding(domain_id, body));
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
          .describe("Base64-encoded image bytes (PNG/JPG, ≤1 MB)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, slot, content_base64 }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("set a brand logo");
      }
      return callApi(() => client.setDomainBrandLogo(domain_id, slot, content_base64));
    },
  );

  server.registerTool(
    "verify_domain_branding_dns",
    {
      title: "Verify Domain Branding DNS",
      description:
        "Queue a DNS check + SSL provisioning for this domain's enabled branded hosts. Run after the CNAME records (from get_domain_branding) resolve. Requires the White Label add-on — without it returns white_label_inactive. Hosts move draft/pending_dns → active once DNS resolves and the certificate is issued; poll get_domain_branding for status. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z.number().int().positive().describe("The domain ID"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("verify branding DNS");
      }
      return callApi(() => client.verifyDomainBrandingDns(domain_id));
    },
  );

  server.registerTool(
    "create_branding_preview",
    {
      title: "Create Branding Preview",
      description:
        "Mint a one-time trial-preview link that shows the account dashboard running under this domain's brand on a temporary <token>.preview host — no White Label add-on required. The link auto-logs the owner in once (single-use, short-lived). Useful to demo the brand before purchase. Returns { url, expires_in }. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: z
          .number()
          .int()
          .positive()
          .describe("The domain ID with a saved brand"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("create a branding preview");
      }
      return callApi(() => client.createBrandingPreview(domain_id));
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
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, slot }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("remove a brand asset");
      }
      return callApi(() => client.removeDomainBrandLogo(domain_id, slot));
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
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, scope }) => {
      if (!config.allowDestructive) {
        return destructiveDisabled("remove branding");
      }
      return callApi(() => client.removeDomainBranding(domain_id, scope));
    },
  );
}
