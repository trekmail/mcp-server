import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageContactTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "list_contacts",
    {
      title: "List Contacts",
      description: "List contacts for the mailbox with optional search and pagination.",
      inputSchema: {
        q: z.string().max(100).optional().describe("Search query (name or email)"),
        per_page: z.number().int().min(1).max(100).optional().describe("Results per page (default 50)"),
        page: z.number().int().min(1).optional().describe("Page number"),
      },
    },
    async ({ q, per_page, page }) => {
      return callApi(() => client.listContacts({ q, per_page, page }));
    },
  );

  server.registerTool(
    "create_contact",
    {
      title: "Create Contact",
      description: "Create a new contact or return existing if email already exists.",
      inputSchema: {
        email: z.string().email().describe("Contact email address"),
        name: z.string().max(255).optional(),
        company: z.string().max(255).optional(),
        job_title: z.string().max(255).optional(),
        phone: z.string().max(50).optional(),
        address: z.string().max(500).optional(),
        birthday: z.string().optional().describe("Date in YYYY-MM-DD format"),
        notes: z.string().max(5000).optional(),
      },
    },
    async (params) => {
      return callApi(() => client.createContact(params));
    },
  );

  server.registerTool(
    "update_contact",
    {
      title: "Update Contact",
      description: "Update an existing contact's details.",
      inputSchema: {
        id: z.number().int().positive().describe("Contact ID"),
        email: z.string().email().optional(),
        name: z.string().max(255).optional(),
        company: z.string().max(255).optional(),
        job_title: z.string().max(255).optional(),
        phone: z.string().max(50).optional(),
        address: z.string().max(500).optional(),
        birthday: z.string().optional(),
        notes: z.string().max(5000).optional(),
      },
    },
    async ({ id, ...rest }) => {
      return callApi(() => client.updateContact(id, rest));
    },
  );

  server.registerTool(
    "delete_contact",
    {
      title: "Delete Contact",
      description: "Delete a contact. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        id: z.number().int().positive().describe("Contact ID"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      if (!config.allowDestructive) {
        return errorResult("Contact deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
      }
      return callApi(() => client.deleteContact(id));
    },
  );

  server.registerTool(
    "import_contacts",
    {
      title: "Import Contacts",
      description: "Import contacts from a base64-encoded CSV or VCF file (max 2 MB).",
      inputSchema: {
        content_base64: z.string().describe("Base64-encoded file content"),
        format: z.enum(["csv", "vcf"]).describe("File format"),
      },
    },
    async ({ content_base64, format }) => {
      return callApi(() => client.importContacts({ content_base64, format }));
    },
  );

  server.registerTool(
    "export_contacts",
    {
      title: "Export Contacts",
      description: "Export all contacts as base64-encoded CSV or VCF.",
      inputSchema: {
        format: z.enum(["csv", "vcard"]).optional().describe("Export format (default: csv)"),
      },
    },
    async ({ format }) => {
      return callApi(() => client.exportContacts({ format }));
    },
  );
}
