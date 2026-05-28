import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageTemplateTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool("list_templates", {
    title: "List Templates",
    description: "List email templates for the mailbox.",
    inputSchema: {},
  }, async () => callApi(() => client.listTemplates()));

  server.registerTool("create_template", {
    title: "Create Template",
    description: "Create a new email template.",
    inputSchema: {
      name: z.string().max(255).describe("Template name"),
      subject: z.string().max(500).optional().describe("Default subject line"),
      body_html: z.string().max(50000).describe("HTML body content"),
    },
      annotations: { destructiveHint: true },
  }, async (params) => {
    if (!config.allowDestructive) {
      return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create templates.");
    }
    return callApi(() => client.createTemplate(params));
  });

  server.registerTool("update_template", {
    title: "Update Template",
    description: "Update an existing email template.",
    inputSchema: {
      id: z.number().int().positive().describe("Template ID"),
      name: z.string().max(255).optional(),
      subject: z.string().max(500).optional(),
      body_html: z.string().max(50000).optional(),
    },
      annotations: { destructiveHint: true },
  }, async ({ id, ...rest }) => {
    if (!config.allowDestructive) {
      return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update templates.");
    }
    return callApi(() => client.updateTemplate(id, rest));
  });

  server.registerTool("delete_template", {
    title: "Delete Template",
    description: "Delete an email template. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
    inputSchema: {
      id: z.number().int().positive().describe("Template ID"),
    },
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    if (!config.allowDestructive) {
      return errorResult("Template deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    return callApi(() => client.deleteTemplate(id));
  });
}
