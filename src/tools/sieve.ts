import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi } from "./util.js";

export function registerSieveTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "get_sieve_script",
    {
      title: "Get Sieve Script",
      description:
        "Get the current Sieve script for a mailbox. Returns the auto-generated script built from visual filters and auto-reply settings. Use this to inspect what is running on the server.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
      },
    },
    async ({ mailbox_id }) => {
      return callApi(() => client.getSieveScript(mailbox_id));
    },
  );

  server.registerTool(
    "upload_sieve_script",
    {
      title: "Upload Raw Sieve Script",
      description:
        "Upload and activate a custom Sieve script for a mailbox. This replaces any visual filters. The server validates syntax before activating. Agency plan only. Dangerous extensions (vnd.dovecot.pipe, vnd.dovecot.execute, vnd.dovecot.filter) are blocked.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
        script: z
          .string()
          .max(10000)
          .describe(
            "The raw Sieve script. Must include a require statement for all extensions used. Max 10,000 characters.",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, script, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "upload_sieve_script",
        { mailbox_id },
        idempotency_key,
      );
      return callApi(() =>
        client.uploadSieveScript(mailbox_id, script, idemKey),
      );
    },
  );
}
