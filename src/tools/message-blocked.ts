import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageBlockedTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool("list_blocked_senders", {
    title: "List Blocked Senders",
    description: "List all blocked email addresses and domains for the mailbox.",
    inputSchema: {},
  }, async () => callApi(() => client.listBlockedSenders()));

  server.registerTool("block_sender", {
    title: "Block Sender",
    description: "Block an email address (e.g. spammer@evil.com) or entire domain (e.g. @evil.com). Max 50 per mailbox.",
    inputSchema: {
      email_or_domain: z
        .string()
        .max(255)
        .describe("Email address or @domain to block"),
    },
  }, async ({ email_or_domain }) => {
    return callApi(() => client.blockSender({ email_or_domain }));
  });

  server.registerTool("unblock_sender", {
    title: "Unblock Sender",
    description: "Remove a sender from the blocked list. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
    inputSchema: {
      id: z.number().int().positive().describe("Blocked sender ID"),
    },
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    if (!config.allowDestructive) {
      return errorResult("Unblocking is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    return callApi(() => client.unblockSender(id));
  });
}
