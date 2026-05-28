import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageTokenTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "create_message_token",
    {
      title: "Create Message Token",
      description:
        "Create a message API token for a mailbox. The token grants access to read, write, or send messages for that mailbox. The plain token is returned only once.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to create a token for"),
        name: z
          .string()
          .max(255)
          .describe("A human-readable name for the token"),
        scopes: z
          .array(z.enum(["messages:read", "messages:write", "messages:send"]))
          .min(1)
          .describe(
            "Scopes to grant: messages:read (list/get), messages:write (flags/move/delete), messages:send (send emails)",
          ),
        expires_in: z
          .enum(["7d", "30d", "90d", "never"])
          .optional()
          .describe("Token expiration period (default: never)"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, name, scopes, expires_in, idempotency_key }) => {
      // #163 follow-up — scope-aware gate. Once minted, this token operates
      // outside MCP entirely (any HTTP client can use it), so the gate must
      // match the WORST scope being granted, not just "is creating a token
      // generally destructive". Otherwise a prompt-injection chain could mint
      // a messages:send token even with TREKMAIL_ALLOW_SENDING=false and
      // exfil it for unrestricted use.
      if (scopes.includes("messages:send") && !config.allowSending) {
        return errorResult(
          "Cannot mint a token with messages:send scope while TREKMAIL_ALLOW_SENDING=false. Set TREKMAIL_ALLOW_SENDING=true to permit, or omit messages:send from scopes.",
        );
      }
      if (scopes.includes("messages:write") && !config.allowDestructive) {
        return errorResult(
          "Cannot mint a token with messages:write scope (modify/move/delete) while TREKMAIL_ALLOW_DESTRUCTIVE=false. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to permit, or omit messages:write from scopes.",
        );
      }
      // messages:read alone is unrestricted — read tokens are safe to mint
      // even when destructive/sending flags are off.
      const idemKey = idempotencyKey(
        "create_message_token",
        { mailbox_id, name, scopes: scopes.sort().join(",") },
        idempotency_key,
      );
      return callApi(() =>
        client.createMessageToken(
          mailbox_id,
          { name, scopes, expires_in },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "list_message_tokens",
    {
      title: "List Message Tokens",
      description:
        "List all message API tokens for a mailbox. Shows token prefix, name, scopes, and status. Does not reveal the full token.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID to list tokens for"),
        page: z.number().int().positive().optional().describe("Page number"),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Items per page (max 20, API-enforced)"),
      },
    },
    async ({ mailbox_id, page, per_page }) => {
      return callApi(() =>
        client.listMessageTokens(mailbox_id, { page, per_page }),
      );
    },
  );

  server.registerTool(
    "revoke_message_token",
    {
      title: "Revoke Message Token",
      description:
        "Revoke a message API token. The token will no longer be usable for message operations. This action cannot be undone.",
      inputSchema: {
        token_id: z
          .number()
          .int()
          .positive()
          .describe("The message token ID to revoke"),
      },
      annotations: {
        destructiveHint: true,
      },
    },
    async ({ token_id }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to revoke tokens.",
        );
      }
      return callApi(() => client.revokeMessageToken(token_id));
    },
  );
}
