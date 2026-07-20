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
        "Create a new IMAP folder in the mailbox. Folder names cannot use reserved names (INBOX, Sent, Drafts, Junk, Trash, Archive, Scheduled). To create a nested subfolder, pass `parent` with the raw path of an existing folder (e.g. parent=\"Projects\" + name=\"2026\" creates \"Projects/2026\"). To move/reparent an existing folder, use rename_folder with a full target path.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(255)
          .describe("Name for the new folder (leaf name only; may not contain the server's hierarchy delimiter)"),
        parent: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe("Optional raw path of an existing parent folder to nest the new folder under"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ name, parent }) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create folders.");
      }
      return callApi(() => client.createFolder(name, parent));
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
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to rename folders.");
      }
      return callApi(() => client.renameFolder(path, name));
    },
  );

  server.registerTool(
    "delete_folder",
    {
      title: "Delete Folder",
      description:
        "Delete a leaf IMAP folder and all messages it contains. A folder with child folders is rejected; delete its children explicitly first. Special folders cannot be deleted. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
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
