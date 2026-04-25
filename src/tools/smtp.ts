import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult, isPrivateHost } from "./util.js";

export function registerSmtpTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "get_smtp_config",
    {
      title: "Get SMTP Configuration",
      description:
        "Get the current SMTP configuration for the account, including mode (platform/custom) and connection details.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.getSmtpConfig());
    },
  );

  server.registerTool(
    "update_smtp_config",
    {
      title: "Update SMTP Configuration",
      description:
        "Update the SMTP configuration. Switch between platform and custom SMTP, or update custom SMTP settings. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        mode: z
          .enum(["custom", "platform"])
          .describe("SMTP mode: 'custom' for your own server, 'platform' for TrekMail's servers"),
        host: z
          .string()
          .max(255)
          .optional()
          .describe("SMTP host (required for custom mode)"),
        port: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .optional()
          .describe("SMTP port (required for custom mode)"),
        encryption: z
          .enum(["none", "ssl", "tls"])
          .optional()
          .describe("Encryption type (required for custom mode)"),
        username: z
          .string()
          .max(255)
          .optional()
          .describe("SMTP username (required for custom mode)"),
        password: z
          .string()
          .max(255)
          .optional()
          .describe("SMTP password (required for new custom connections)"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mode, host, port, encryption, username, password, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "SMTP config update is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable.",
        );
      }
      if (host && isPrivateHost(host)) {
        return errorResult("Cannot connect to private/internal network addresses.");
      }
      const idemKey = idempotencyKey(
        "update_smtp_config",
        { mode, host, port, encryption, username },
        idempotency_key,
      );
      return callApi(() =>
        client.updateSmtpConfig(
          { mode, host, port, encryption, username, password },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "delete_smtp_connection",
    {
      title: "Delete SMTP Connection",
      description:
        "Delete a custom SMTP connection. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        connection_id: z
          .number()
          .int()
          .positive()
          .describe("The SMTP connection ID to delete"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ connection_id, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "SMTP connection deletion is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable.",
        );
      }
      const idemKey = idempotencyKey("delete_smtp_connection", { connection_id }, idempotency_key);
      return callApi(() => client.deleteSmtpConnection(connection_id, idemKey));
    },
  );

  server.registerTool(
    "test_smtp",
    {
      title: "Test SMTP Connection",
      description:
        "Test an SMTP connection with the provided credentials. Returns a job_id to poll for results.",
      inputSchema: {
        host: z.string().max(255).describe("SMTP host"),
        port: z
          .number()
          .int()
          .min(1)
          .max(65535)
          .describe("SMTP port"),
        encryption: z
          .enum(["none", "ssl", "tls"])
          .describe("Encryption type"),
        username: z.string().max(255).describe("SMTP username"),
        password: z.string().max(255).describe("SMTP password"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
    },
    async ({ host, port, encryption, username, password, idempotency_key }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "SMTP connection testing is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable (it triggers outbound connections).",
        );
      }
      if (isPrivateHost(host)) {
        return errorResult("Cannot connect to private/internal network addresses.");
      }
      const idemKey = idempotencyKey(
        "test_smtp",
        { host, port, encryption, username },
        idempotency_key,
      );
      return callApi(() =>
        client.testSmtp(
          { host, port, encryption, username, password },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "get_smtp_test_status",
    {
      title: "Get SMTP Test Status",
      description:
        "Poll the result of an SMTP connection test by job_id.",
      inputSchema: {
        job_id: z.string().describe("The job ID returned from test_smtp"),
      },
    },
    async ({ job_id }) => {
      return callApi(() => client.getSmtpTestStatus(job_id));
    },
  );
}
