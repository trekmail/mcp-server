import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { callApi } from "./util.js";

const supportedLocale = z
  .enum(["en", "es", "fr", "de", "pt", "it", "nl", "ru", "zh", "ja", "ko", "ar", "he"])
  .optional()
  .describe("Language for setup guidance or Apple profile text (defaults to English)");

export function registerMailClientSetupTools(
  server: McpServer,
  client: TrekMailClient,
): void {
  server.registerTool(
    "get_mail_client_setup",
    {
      title: "Get Mail Client Setup",
      description:
        "Get password-free IMAP and SMTP settings plus localized three-step guides for Gmail, Outlook, Apple Mail, Thunderbird, and other IMAP apps. For each delegated shared mailbox, reports durable native-access readiness, effective send_as_ready/send_as_reason, exact Inbox/Sent/Archive/Junk paths, read/flag/folder/move/delete/send-as capabilities, and whether SMTP saves a Sent copy. Wait for native_access_ready=true and, for sending, send_as_ready=true. The user always authenticates with the regular member mailbox address and password; no mailbox password or custom SMTP provider credential is returned.",
      inputSchema: {
        mailbox_id: z.number().int().positive().describe("The regular mailbox ID"),
        locale: supportedLocale,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ mailbox_id, locale }) =>
      callApi(() => client.getMailClientSetup(mailbox_id, locale)),
  );

  server.registerTool(
    "get_apple_mail_profile",
    {
      title: "Get Apple Mail Profile",
      description:
        "Generate a password-free Apple Mail .mobileconfig file for a mailbox whose incoming and outgoing mail are ready. Returns file_name, media_type, encoding=base64, and content_base64. Decode the Base64 bytes to save or deliver the file; Apple prompts the user for the mailbox password during installation.",
      inputSchema: {
        mailbox_id: z.number().int().positive().describe("The regular mailbox ID"),
        locale: supportedLocale,
      },
      annotations: { readOnlyHint: true },
    },
    async ({ mailbox_id, locale }) =>
      callApi(() => client.getAppleMailProfile(mailbox_id, locale)),
  );
}
