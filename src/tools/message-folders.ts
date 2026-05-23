import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageFolderTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "create_folder",
    {
      title: "Create Folder",
      description:
        "Create a new IMAP folder in the mailbox. Folder names cannot use reserved names (INBOX, Sent, Drafts, Junk, Trash, Archive, Scheduled).",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(255)
          .describe("Name for the new folder"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ name }) => {
      return callApi(() => client.createFolder(name));
    },
  );

  server.registerTool(
    "rename_folder",
    {
      title: "Rename Folder",
      description:
        "Rename an existing IMAP folder. Special folders (INBOX, Sent, Drafts, Junk, Trash, Archive, Scheduled) cannot be renamed.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .max(255)
          .describe("Current folder path to rename"),
        name: z
          .string()
          .min(1)
          .max(255)
          .describe("New name for the folder"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ path, name }) => {
      return callApi(() => client.renameFolder(path, name));
    },
  );

  server.registerTool(
    "delete_folder",
    {
      title: "Delete Folder",
      description:
        "Delete an IMAP folder and all its contents. Special folders cannot be deleted. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        path: z
          .string()
          .min(1)
          .max(255)
          .describe("Folder path to delete"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ path }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Folder deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable.",
        );
      }
      return callApi(() => client.deleteFolder(path));
    },
  );

  server.registerTool(
    "empty_folder",
    {
      title: "Empty Folder",
      description:
        "Delete all messages in Trash or Junk folder. Only these two folders can be emptied. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        folder: z
          .enum(["Trash", "Junk"])
          .describe("Folder to empty (only Trash or Junk allowed)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ folder }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Emptying folders is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable.",
        );
      }
      return callApi(() => client.emptyFolder(folder));
    },
  );
}
