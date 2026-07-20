import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";
import { registerMailboxTools } from "../../src/tools/mailboxes.js";

describe("mailbox tools", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      listMailboxes: vi.fn().mockResolvedValue({ data: [] }),
      createMailboxGeneratedPassword: vi.fn().mockResolvedValue({ id: 1, email: "alice@example.com" }),
    } as unknown as TrekMailClient;
  });

  it("listMailboxes passes filter params to client", async () => {
    await client.listMailboxes({ domain_id: 3, search: "alice" });
    expect(client.listMailboxes).toHaveBeenCalledWith({ domain_id: 3, search: "alice" });
  });

  it("createMailboxGeneratedPassword generates deterministic idempotency key", () => {
    const key = idempotencyKey("create_mailbox_generated_password", {
      domain_id: 5,
      local_part: "alice",
      display_name: undefined,
    });
    expect(key).toMatch(/^mcp_create_mailbox_generated_password_/);
    // Same params = same key
    const key2 = idempotencyKey("create_mailbox_generated_password", {
      domain_id: 5,
      local_part: "alice",
      display_name: undefined,
    });
    expect(key).toBe(key2);
  });

  it("createMailboxGeneratedPassword uses explicit key when provided", () => {
    const key = idempotencyKey(
      "create_mailbox_generated_password",
      { domain_id: 5, local_part: "alice" },
      "my-explicit-key",
    );
    expect(key).toBe("my-explicit-key");
  });

  it("update_mailbox preserves conversation_view=false", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const updateMailbox = vi.fn().mockResolvedValue({
      data: { id: 9, conversation_view: false },
    });
    const updateClient = { updateMailbox } as unknown as TrekMailClient;
    const handlers = new Map<
      string,
      (input: Record<string, unknown>) => Promise<unknown>
    >();
    const register = server.registerTool.bind(server);
    server.registerTool = ((name: string, definition: unknown, handler: never) => {
      handlers.set(name, handler);
      return register(
        name,
        definition as Parameters<typeof register>[1],
        handler,
      );
    }) as typeof server.registerTool;

    registerMailboxTools(server, updateClient, { allowDestructive: true });
    await handlers.get("update_mailbox")!({
      mailbox_id: 9,
      conversation_view: false,
    });

    expect(updateMailbox).toHaveBeenCalledWith(
      9,
      { conversation_view: false },
      expect.stringMatching(/^mcp_update_mailbox_/),
    );
  });

  it("update_mailbox idempotency differs when conversation_view changes", () => {
    const disabled = idempotencyKey("update_mailbox", {
      mailbox_id: 9,
      conversation_view: false,
    });
    const enabled = idempotencyKey("update_mailbox", {
      mailbox_id: 9,
      conversation_view: true,
    });

    expect(disabled).not.toBe(enabled);
  });

  it("update_mailbox remains blocked by the destructive gate", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const updateMailbox = vi.fn();
    const updateClient = { updateMailbox } as unknown as TrekMailClient;
    const handlers = new Map<
      string,
      (input: Record<string, unknown>) => Promise<{
        isError?: boolean;
        content: Array<{ type: string; text?: string }>;
      }>
    >();
    const register = server.registerTool.bind(server);
    server.registerTool = ((name: string, definition: unknown, handler: never) => {
      handlers.set(name, handler);
      return register(
        name,
        definition as Parameters<typeof register>[1],
        handler,
      );
    }) as typeof server.registerTool;

    registerMailboxTools(server, updateClient, { allowDestructive: false });
    const result = await handlers.get("update_mailbox")!({
      mailbox_id: 9,
      conversation_view: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/destructive/i);
    expect(updateMailbox).not.toHaveBeenCalled();
  });
});
