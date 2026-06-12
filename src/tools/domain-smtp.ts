import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult, isPrivateHost } from "./util.js";

/**
 * Per-domain SMTP routing tools (Domain-SMTP feature). The domain is the source
 * of truth for outbound routing: platform (managed), a reusable saved profile,
 * or not_configured. The legacy account-level SMTP tools remain for back-compat.
 */
export function registerDomainSmtpTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  const domainId = z.number().int().positive().describe("The domain ID");

  server.registerTool(
    "get_domain_smtp",
    {
      title: "Get Domain SMTP Route",
      description:
        "Get the outbound SMTP route for a domain: mode (platform/profile/not_configured/inherit) and the selected profile. When mode=inherit, effective_smtp_mode shows what the account-wide default resolves to.",
      inputSchema: { domain_id: domainId },
    },
    async ({ domain_id }) => callApi(() => client.getDomainSmtp(domain_id)),
  );

  server.registerTool(
    "set_domain_smtp",
    {
      title: "Set Domain SMTP Route",
      description:
        "Set how a domain sends outbound mail: 'platform' (managed, paid plans), 'profile' (a saved SMTP profile — pass smtp_connection_id), 'not_configured' (block sending), or 'inherit' (follow the account-wide default). Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: domainId,
        smtp_mode: z.enum(["platform", "profile", "not_configured", "inherit"]).describe("Outbound route"),
        smtp_connection_id: z.number().int().positive().optional().describe("Profile id (required when smtp_mode=profile)"),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, smtp_mode, smtp_connection_id, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult("Changing a domain's SMTP route is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable.");
      }
      const idemKey = idempotencyKey("set_domain_smtp", { domain_id, smtp_mode, smtp_connection_id }, idempotency_key);
      return callApi(() => client.setDomainSmtp(domain_id, { smtp_mode, smtp_connection_id }, idemKey));
    },
  );

  server.registerTool(
    "get_account_smtp_default",
    {
      title: "Get Account Default SMTP Route",
      description:
        "Get the account-wide default outbound route that new domains start on (and that 'inherit' domains follow): default_smtp_mode (null until explicitly set) plus effective_default_smtp_mode, which is the plan baseline used when it's null (managed platform on paid plans, otherwise not_configured).",
      inputSchema: {},
    },
    async () => callApi(() => client.getAccountSmtpDefault()),
  );

  server.registerTool(
    "set_account_smtp_default",
    {
      title: "Set Account Default SMTP Route",
      description:
        "Set the account-wide default route that new domains start on: 'platform' (managed, paid plans), 'profile' (a saved SMTP profile — pass smtp_connection_id), or 'not_configured'. Pass apply_to_all=true to also switch every existing domain to this route now. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        smtp_mode: z.enum(["platform", "profile", "not_configured"]).describe("Account-wide default route"),
        smtp_connection_id: z.number().int().positive().optional().describe("Profile id (required when smtp_mode=profile)"),
        apply_to_all: z.boolean().optional().describe("Also switch every existing domain to this route now"),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ smtp_mode, smtp_connection_id, apply_to_all, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult("Changing the account default SMTP route is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable.");
      }
      const idemKey = idempotencyKey("set_account_smtp_default", { smtp_mode, smtp_connection_id, apply_to_all }, idempotency_key);
      return callApi(() => client.setAccountSmtpDefault({ smtp_mode, smtp_connection_id, apply_to_all }, idemKey));
    },
  );

  server.registerTool(
    "list_domain_smtp_profiles",
    {
      title: "List SMTP Profiles",
      description: "List the account's reusable saved SMTP profiles (with per-profile domain usage counts).",
      inputSchema: { domain_id: domainId },
    },
    async ({ domain_id }) => callApi(() => client.listDomainSmtpProfiles(domain_id)),
  );

  server.registerTool(
    "create_domain_smtp_profile",
    {
      title: "Create SMTP Profile",
      description:
        "Create a reusable SMTP profile and apply it to this domain. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true (it stores credentials).",
      inputSchema: {
        domain_id: domainId,
        name: z.string().max(80).describe("Profile name"),
        host: z.string().max(255).describe("SMTP host"),
        port: z.number().int().describe("SMTP port (25, 465, 587 or 2525)"),
        encryption: z.enum(["none", "ssl", "tls"]),
        username: z.string().max(255),
        password: z.string().max(255),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, name, host, port, encryption, username, password, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult("Creating an SMTP profile is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable.");
      }
      if (isPrivateHost(host)) {
        return errorResult("Cannot use private/internal network addresses.");
      }
      const idemKey = idempotencyKey("create_domain_smtp_profile", { domain_id, host, username }, idempotency_key);
      return callApi(() => client.createDomainSmtpProfile(domain_id, { name, host, port, encryption, username, password }, idemKey));
    },
  );

  server.registerTool(
    "update_domain_smtp_profile",
    {
      title: "Update SMTP Profile",
      description:
        "Update a saved SMTP profile (affects every domain using it). Omit password to keep the current one. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: domainId,
        profile_id: z.number().int().positive(),
        name: z.string().max(80),
        host: z.string().max(255),
        port: z.number().int(),
        encryption: z.enum(["none", "ssl", "tls"]),
        username: z.string().max(255),
        password: z.string().max(255).optional(),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, profile_id, name, host, port, encryption, username, password, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult("Updating an SMTP profile is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable.");
      }
      if (isPrivateHost(host)) {
        return errorResult("Cannot use private/internal network addresses.");
      }
      const idemKey = idempotencyKey("update_domain_smtp_profile", { domain_id, profile_id, host }, idempotency_key);
      return callApi(() => client.updateDomainSmtpProfile(domain_id, profile_id, { name, host, port, encryption, username, password }, idemKey));
    },
  );

  server.registerTool(
    "delete_domain_smtp_profile",
    {
      title: "Delete SMTP Profile",
      description:
        "Delete a saved SMTP profile. Domains using it are reassigned automatically (to managed SMTP on paid plans, otherwise not_configured). Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        domain_id: domainId,
        profile_id: z.number().int().positive(),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, profile_id, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult("Deleting an SMTP profile is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable.");
      }
      const idemKey = idempotencyKey("delete_domain_smtp_profile", { domain_id, profile_id }, idempotency_key);
      return callApi(() => client.deleteDomainSmtpProfile(domain_id, profile_id, idemKey));
    },
  );

  server.registerTool(
    "test_domain_smtp",
    {
      title: "Test Domain SMTP",
      description:
        "Test a domain's SMTP route. mode='platform' tests managed SMTP via a domain mailbox; mode='custom' tests a saved profile (smtp_connection_id) or ad-hoc credentials. Returns a job_id to poll. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true (triggers outbound connections).",
      inputSchema: {
        domain_id: domainId,
        mode: z.enum(["platform", "custom"]).default("custom"),
        smtp_connection_id: z.number().int().positive().optional(),
        host: z.string().max(255).optional(),
        port: z.number().int().optional(),
        encryption: z.enum(["none", "ssl", "tls"]).optional(),
        username: z.string().max(255).optional(),
        password: z.string().max(255).optional(),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ domain_id, mode, smtp_connection_id, host, port, encryption, username, password, idempotency_key }) => {
      if (!config?.allowDestructive) {
        return errorResult("SMTP testing is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable (it triggers outbound connections).");
      }
      if (host && isPrivateHost(host)) {
        return errorResult("Cannot connect to private/internal network addresses.");
      }
      const body: Record<string, unknown> = { mode };
      if (smtp_connection_id) body.smtp_connection_id = smtp_connection_id;
      if (host) body.host = host;
      if (port) body.port = port;
      if (encryption) body.encryption = encryption;
      if (username) body.username = username;
      if (password) body.password = password;
      const idemKey = idempotencyKey("test_domain_smtp", { domain_id, mode, smtp_connection_id, host }, idempotency_key);
      return callApi(() => client.testDomainSmtp(domain_id, body, idemKey));
    },
  );

  server.registerTool(
    "get_domain_smtp_test_status",
    {
      title: "Get Domain SMTP Test Status",
      description: "Poll the result of a domain SMTP test by job_id.",
      inputSchema: {
        domain_id: domainId,
        job_id: z.string().describe("The job ID returned from test_domain_smtp"),
      },
    },
    async ({ domain_id, job_id }) => callApi(() => client.getDomainSmtpTestStatus(domain_id, job_id)),
  );
}
