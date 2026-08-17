import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

export function registerMessageIdentityTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool("list_identities", {
    title: "List Sending Addresses",
    description:
      "List valid From addresses, connected-inbox Send As identities, reply policy, eligible domains, and permitted saved SMTP profiles. Pass external_account_id to see addresses usable from that connected inbox. Requires scope: messages:read.",
    inputSchema: {
      external_account_id: z.number().int().positive().optional().describe("Connected inbox whose From addresses should be listed"),
    },
  }, async ({ external_account_id }) => callApi(() => client.listIdentities({ external_account_id })));

  server.registerTool("create_identity", {
    title: "Create or Configure Sending Address",
    description:
      "Configure an existing mailbox/alias persona, or create a Send As identity. Pass external_account_id when you read that address's mail through a connected inbox; omit it when the mail is forwarded into this TrekMail mailbox instead. Either way, email must already be the mailbox address or a send-enabled alias. smtp_mode=domain follows Dashboard domain routing; smtp_mode=profile selects a saved profile and is limited to the account owner mailbox. Requires scope: messages:write.",
    inputSchema: {
      kind: z.enum(["managed", "send_as"]).optional().describe("Default: managed"),
      email: z.string().email().describe("Visible From address"),
      name: z.string().max(255).nullable().optional(),
      reply_to: z.string().email().nullable().optional(),
      signature_html: z.string().max(10000).nullable().optional(),
      signature_enabled: z.boolean().optional(),
      external_account_id: z.number().int().positive().optional().describe("Connected inbox this address is read in; omit for a forwarded-copy workflow"),
      smtp_mode: z.enum(["domain", "profile"]).optional(),
      smtp_connection_id: z.number().int().positive().optional().describe("Required when smtp_mode=profile"),
      idempotency_key: z.string().optional(),
    },
    annotations: { destructiveHint: true },
  }, async ({ idempotency_key, ...params }) => {
    if (!config.allowDestructive) {
      return errorResult("Identity changes are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    if (params.smtp_mode === "profile" && !params.smtp_connection_id) {
      return errorResult("smtp_connection_id is required when smtp_mode=profile.");
    }
    const key = idempotencyKey("create_identity", params, idempotency_key);
    return callApi(() => client.createIdentity(params, key));
  });

  server.registerTool("update_identity", {
    title: "Update Sending Address",
    description:
      "Update name, reply-to, signature, default status, or SMTP route. When updating a connected-inbox Send As identity, pass its external_account_id so the API can enforce the exact source binding. Requires scope: messages:write.",
    inputSchema: {
      id: z.number().int().positive().describe("Identity ID"),
      name: z.string().max(255).nullable().optional(),
      reply_to: z.string().email().nullable().optional(),
      signature_html: z.string().max(10000).nullable().optional(),
      signature_enabled: z.boolean().optional(),
      is_default: z.boolean().optional(),
      external_account_id: z.number().int().positive().optional(),
      smtp_mode: z.enum(["domain", "profile"]).optional(),
      smtp_connection_id: z.number().int().positive().nullable().optional(),
      idempotency_key: z.string().optional(),
    },
    annotations: { destructiveHint: true },
  }, async ({ id, idempotency_key, ...rest }) => {
    if (!config.allowDestructive) {
      return errorResult("Identity changes are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    if (rest.smtp_mode === "profile" && !rest.smtp_connection_id) {
      return errorResult("smtp_connection_id is required when smtp_mode=profile.");
    }
    const key = idempotencyKey("update_identity", { id, ...rest }, idempotency_key);
    return callApi(() => client.updateIdentity(id, rest, key));
  });

  server.registerTool("delete_identity", {
    title: "Delete Send As Identity",
    description:
      "Delete a Send As identity. Managed mailbox/alias identities cannot be deleted here. Pass external_account_id for a connected-inbox identity. Requires scope: messages:write and TREKMAIL_ALLOW_DESTRUCTIVE=true.",
    inputSchema: {
      id: z.number().int().positive().describe("Identity ID"),
      external_account_id: z.number().int().positive().optional(),
    },
    annotations: { destructiveHint: true },
  }, async ({ id, external_account_id }) => {
    if (!config.allowDestructive) {
      return errorResult("Identity deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    return callApi(() => client.deleteIdentity(id, external_account_id));
  });

  server.registerTool("set_reply_from_policy", {
    title: "Set Reply From Policy",
    description:
      "Choose whether replies use the address that received the message or always use the mailbox default. Requires scope: messages:write.",
    inputSchema: {
      reply_from_policy: z.enum(["recipient", "default"]),
      idempotency_key: z.string().optional(),
    },
    annotations: { destructiveHint: true },
  }, async ({ reply_from_policy, idempotency_key }) => {
    if (!config.allowDestructive) {
      return errorResult("Identity changes are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true.");
    }
    const key = idempotencyKey("set_reply_from_policy", { reply_from_policy }, idempotency_key);
    return callApi(() => client.setReplyFromPolicy(reply_from_policy, key));
  });
}
