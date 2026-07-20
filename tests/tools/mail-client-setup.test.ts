import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../../src/client.js";
import { registerMailClientSetupTools } from "../../src/tools/mail-client-setup.js";

function harness() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    getMailClientSetup: vi.fn().mockResolvedValue({ data: { sending: { ready: true } } }),
    getAppleMailProfile: vi.fn().mockResolvedValue({
      file_name: "trekmail-apple-mail-7.mobileconfig",
      media_type: "application/x-apple-aspen-config",
      encoding: "base64",
      content_base64: "PHBsaXN0Lz4=",
      password_included: false,
    }),
  } as unknown as TrekMailClient;

  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const original = server.registerTool.bind(server);
  server.registerTool = ((name: string, definition: unknown, handler: never) => {
    handlers.set(name, handler);
    return original(name, definition as Parameters<typeof original>[1], handler);
  }) as typeof server.registerTool;

  registerMailClientSetupTools(server, client);

  return { server, client, handlers };
}

describe("mail client setup tools", () => {
  it("registers both tools as read-only", () => {
    const { server } = harness();
    const tools = (server as unknown as {
      _registeredTools: Record<string, { annotations?: { readOnlyHint?: boolean } }>;
    })._registeredTools;

    expect(tools.get_mail_client_setup.annotations?.readOnlyHint).toBe(true);
    expect(tools.get_apple_mail_profile.annotations?.readOnlyHint).toBe(true);
  });

  it("documents shared readiness, folder operations, and Sent-copy ownership", () => {
    const { server } = harness();
    const tools = (server as unknown as {
      _registeredTools: Record<string, { description?: string }>;
    })._registeredTools;
    const description = tools.get_mail_client_setup.description ?? "";

    expect(description).toContain("native_access_ready=true");
    expect(description).toContain("send_as_ready=true");
    expect(description).toContain("Inbox/Sent/Archive/Junk");
    expect(description).toContain("whether SMTP saves a Sent copy");
  });

  it("forwards mailbox id to the setup API", async () => {
    const { client, handlers } = harness();

    await handlers.get("get_mail_client_setup")!({ mailbox_id: 7, locale: "ru" });

    expect(client.getMailClientSetup).toHaveBeenCalledWith(7, "ru");
  });

  it("forwards mailbox id and locale to the profile API", async () => {
    const { client, handlers } = harness();

    const result = await handlers.get("get_apple_mail_profile")!({ mailbox_id: 7, locale: "ru" });

    expect(client.getAppleMailProfile).toHaveBeenCalledWith(7, "ru");
    expect(JSON.stringify(result)).not.toContain("password_encrypted");
  });
});
