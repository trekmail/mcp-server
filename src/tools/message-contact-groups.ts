import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageContactGroupTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "list_contact_groups",
    {
      title: "List Contact Groups",
      description: "List all contact groups for the mailbox.",
      inputSchema: {},
    },
    async () => callApi(() => client.listContactGroups()),
  );

  server.registerTool(
    "list_contact_group_members",
    {
      title: "List Contact Group Members",
      description: "List the contacts that belong to a contact group, with pagination.",
      inputSchema: {
        id: z.number().int().positive().describe("Group ID"),
        per_page: z.number().int().min(1).max(100).optional().describe("Members per page (default 50)"),
        page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      },
    },
    async ({ id, per_page, page }) =>
      callApi(() => client.listContactGroupMembers(id, { per_page, page })),
  );

  server.registerTool(
    "create_contact_group",
    {
      title: "Create Contact Group",
      description: "Create a new contact group (distribution list).",
      inputSchema: {
        group_name: z.string().max(100).describe("Name for the contact group"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ group_name }) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create contact groups.");
      }
      return callApi(() => client.createContactGroup({ group_name }));
    },
  );

  server.registerTool(
    "update_contact_group",
    {
      title: "Update Contact Group",
      description: "Rename a contact group.",
      inputSchema: {
        id: z.number().int().positive().describe("Group ID"),
        group_name: z.string().max(100).describe("New name for the group"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, group_name }) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update contact groups.");
      }
      return callApi(() => client.updateContactGroup(id, { group_name }));
    },
  );

  server.registerTool(
    "delete_contact_group",
    {
      title: "Delete Contact Group",
      description: "Delete a contact group. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        id: z.number().int().positive().describe("Group ID"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      if (!config.allowDestructive) {
        return errorResult("Contact group deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
      }
      return callApi(() => client.deleteContactGroup(id));
    },
  );

  server.registerTool(
    "add_contact_group_members",
    {
      title: "Add Contact Group Members",
      description: "Add one or more contacts to a group.",
      inputSchema: {
        id: z.number().int().positive().describe("Group ID"),
        contact_ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Array of contact IDs to add"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, contact_ids }) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to add contact group members.");
      }
      return callApi(() => client.addContactGroupMembers(id, { contact_ids }));
    },
  );

  server.registerTool(
    "remove_contact_group_members",
    {
      title: "Remove Contact Group Members",
      description: "Remove one or more contacts from a group.",
      inputSchema: {
        id: z.number().int().positive().describe("Group ID"),
        contact_ids: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Array of contact IDs to remove"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id, contact_ids }) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to remove contact group members.");
      }
      return callApi(() => client.removeContactGroupMembers(id, { contact_ids }));
    },
  );
}
