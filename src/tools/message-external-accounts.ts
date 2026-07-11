import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { callApi, errorResult } from "./util.js";

// Connection fields — mirror the API's ExternalAccountManager::connectionRules
// (keep in lockstep; drift here is the classic MCP-vs-API failure).
const connectionShape = {
  email: z.string().email().describe("The external mailbox address"),
  provider: z
    .enum(["gmail", "yahoo", "aol", "icloud", "outlook", "zoho", "gmx", "yandex", "fastmail", "custom"])
    .describe("Provider preset key ('custom' for a self-hosted IMAP server)"),
  password: z.string().max(1024).describe("Password / app password (app-password providers strip spaces)"),
  imap_host: z.string().max(255),
  imap_port: z.union([z.literal(143), z.literal(993)]),
  imap_encryption: z.enum(["ssl", "tls"]),
  imap_username: z.string().max(255).optional().describe("Defaults to the email address"),
  smtp_host: z.string().max(255),
  smtp_port: z.union([z.literal(465), z.literal(587), z.literal(2525)]),
  smtp_encryption: z.enum(["ssl", "tls"]),
  smtp_username: z.string().max(255).optional(),
  smtp_password: z.string().max(1024).optional().describe("Defaults to the IMAP password"),
};

export function registerMessageExternalAccountTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool("list_external_accounts", {
    title: "List Connected Accounts",
    description: "List the mailbox's connected external accounts (Gmail/Yahoo/iCloud/custom IMAP). Credentials are never returned.",
    inputSchema: {},
  }, async () => callApi(() => client.listExternalAccounts()));

  server.registerTool("detect_external_account", {
    title: "Detect Provider",
    description: "Given an email address, return the provider preset (IMAP/SMTP host/port, app-password requirement) for connecting it.",
    inputSchema: { email: z.string().email() },
  }, async ({ email }) => callApi(() => client.detectExternalAccount(email)));

  // test_external_account — safety gate: allowMigration (makes an outbound
  // IMAP+SMTP connection to an arbitrary host).
  server.registerTool("test_external_account", {
    title: "Test Connection (unsaved)",
    description: "Test IMAP+SMTP credentials without saving. Makes an outbound connection. Requires TREKMAIL_ALLOW_MIGRATION=true.",
    inputSchema: { ...connectionShape },
    annotations: { destructiveHint: false },
  }, async (params) => {
    if (!config.allowMigration) {
      return errorResult("Connection testing makes an outbound network connection. Set TREKMAIL_ALLOW_MIGRATION=true to enable it.");
    }
    return callApi(() => client.testExternalAccount(params));
  });

  // create_external_account — safety gate: allowDestructive (stores credentials
  // AND opens an outbound connection to test them before saving).
  server.registerTool("create_external_account", {
    title: "Connect External Account",
    description: "Connect an external account. Server-side test-gated: broken credentials never persist. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
    inputSchema: {
      ...connectionShape,
      label: z.string().max(255).optional(),
      color: z.string().max(16).optional(),
      include_in_unified: z.boolean().optional().describe("Show in the All-inboxes view (default true)"),
    },
    annotations: { destructiveHint: true },
  }, async (params) => {
    if (!config.allowDestructive) {
      return errorResult("Connecting an account stores credentials. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable it.");
    }
    return callApi(() => client.createExternalAccount(params));
  });

  server.registerTool("update_external_account", {
    title: "Update Connected Account",
    description: "Update a connected account (label/color/unified toggle, or new credentials/host — a connection change is re-tested). Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
    inputSchema: {
      id: z.number().int().positive(),
      label: z.string().max(255).nullable().optional(),
      color: z.string().max(16).optional(),
      include_in_unified: z.boolean().optional(),
      sort_order: z.number().int().min(0).max(1000).optional(),
      password: z.string().max(1024).optional(),
      smtp_password: z.string().max(1024).optional(),
      imap_host: z.string().max(255).optional(),
      imap_port: z.union([z.literal(143), z.literal(993)]).optional(),
      imap_encryption: z.enum(["ssl", "tls"]).optional(),
      imap_username: z.string().max(255).optional(),
      smtp_host: z.string().max(255).optional(),
      smtp_port: z.union([z.literal(465), z.literal(587), z.literal(2525)]).optional(),
      smtp_encryption: z.enum(["ssl", "tls"]).optional(),
      smtp_username: z.string().max(255).optional(),
    },
    annotations: { destructiveHint: true },
  }, async ({ id, ...rest }) => {
    if (!config.allowDestructive) {
      return errorResult("Updating a connected account is a destructive operation. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    return callApi(() => client.updateExternalAccount(id, rest));
  });

  // test_saved_external_account — safety gate: allowMigration (outbound connection).
  server.registerTool("test_saved_external_account", {
    title: "Re-test Connected Account",
    description: "Re-test a saved connected account's stored credentials. Makes an outbound connection. Requires TREKMAIL_ALLOW_MIGRATION=true.",
    inputSchema: { id: z.number().int().positive() },
  }, async ({ id }) => {
    if (!config.allowMigration) {
      return errorResult("Re-testing makes an outbound network connection. Set TREKMAIL_ALLOW_MIGRATION=true to enable it.");
    }
    return callApi(() => client.testSavedExternalAccount(id));
  });

  server.registerTool("delete_external_account", {
    title: "Disconnect External Account",
    description: "Disconnect (remove) an external account. Nothing is deleted on the provider side. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
    inputSchema: { id: z.number().int().positive() },
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    if (!config.allowDestructive) {
      return errorResult("Disconnecting an account is a destructive operation. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    return callApi(() => client.deleteExternalAccount(id));
  });
}
