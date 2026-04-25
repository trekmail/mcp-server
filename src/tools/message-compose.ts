import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { callApi } from "./util.js";

export function registerMessageComposeTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "prepare_reply",
    {
      title: "Prepare Reply",
      description:
        "Get pre-populated reply data for a message: to, subject (Re:), quoted body, in_reply_to. Ready to pass to send or save_draft.",
      inputSchema: {
        uid: z.number().int().positive().describe("IMAP UID of the message to reply to"),
        folder: z.string().max(255).optional().describe("IMAP folder (default: INBOX)"),
      },
    },
    async ({ uid, folder }) => {
      return callApi(() => client.getReply(uid, { folder }));
    },
  );

  server.registerTool(
    "prepare_reply_all",
    {
      title: "Prepare Reply All",
      description:
        "Get pre-populated reply-all data: to + cc (all original recipients except self), subject (Re:), quoted body.",
      inputSchema: {
        uid: z.number().int().positive().describe("IMAP UID"),
        folder: z.string().max(255).optional(),
      },
    },
    async ({ uid, folder }) => {
      return callApi(() => client.getReplyAll(uid, { folder }));
    },
  );

  server.registerTool(
    "prepare_forward",
    {
      title: "Prepare Forward",
      description:
        "Get pre-populated forward data: subject (Fwd:), forwarded body, original attachment metadata.",
      inputSchema: {
        uid: z.number().int().positive().describe("IMAP UID"),
        folder: z.string().max(255).optional(),
      },
    },
    async ({ uid, folder }) => {
      return callApi(() => client.getForward(uid, { folder }));
    },
  );
}
