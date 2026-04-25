import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageIdentityTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool("list_identities", {
    title: "List Identities",
    description: "List send-from identities (addresses with signatures). Auto-creates default if none exists.",
    inputSchema: {},
  }, async () => callApi(() => client.listIdentities()));

  server.registerTool("create_identity", {
    title: "Create Identity",
    description: "Create a send-from identity. Email must be the mailbox address or one of its aliases.",
    inputSchema: {
      email: z.string().email().describe("Send-from email address"),
      name: z.string().max(255).optional(),
      reply_to: z.string().email().optional(),
      signature_html: z.string().max(10000).optional(),
      signature_enabled: z.boolean().optional(),
    },
  }, async (params) => callApi(() => client.createIdentity(params)));

  server.registerTool("update_identity", {
    title: "Update Identity",
    description: "Update an identity's name, reply-to, signature, or default status.",
    inputSchema: {
      id: z.number().int().positive().describe("Identity ID"),
      name: z.string().max(255).optional(),
      reply_to: z.string().email().optional(),
      signature_html: z.string().max(10000).optional(),
      signature_enabled: z.boolean().optional(),
      is_default: z.boolean().optional(),
    },
  }, async ({ id, ...rest }) => callApi(() => client.updateIdentity(id, rest)));

  server.registerTool("delete_identity", {
    title: "Delete Identity",
    description: "Delete an identity. Cannot delete the default identity. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
    inputSchema: {
      id: z.number().int().positive().describe("Identity ID"),
    },
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    if (!config.allowDestructive) {
      return errorResult("Identity deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    return callApi(() => client.deleteIdentity(id));
  });
}
