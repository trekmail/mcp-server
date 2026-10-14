import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

/** Ticket #482: PATCH /mailboxes/{id}/storage, shared storage or a fixed size. */
describe("set_mailbox_storage", () => {
  type Handler = (input: Record<string, unknown>) => Promise<{
    isError?: boolean;
    content: Array<{ type: string; text?: string }>;
  }>;
  type Shape = Record<string, { safeParse(value: unknown): { success: boolean } }>;

  function register(client: TrekMailClient, allowDestructive = true) {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const handlers = new Map<string, Handler>();
    const original = server.registerTool.bind(server);
    server.registerTool = ((name: string, definition: unknown, handler: never) => {
      handlers.set(name, handler);
      return original(name, definition as Parameters<typeof original>[1], handler);
    }) as typeof server.registerTool;
    registerMailboxTools(server, client, { allowDestructive });
    const shape = (server as unknown as {
      _registeredTools: Record<string, { inputSchema: { shape: Shape } }>;
    })._registeredTools.set_mailbox_storage.inputSchema.shape;
    return { handler: handlers.get("set_mailbox_storage")!, shape };
  }

  const realClient = () => new TrekMailClient({
    baseUrl: "https://trekmail.test", token: "tm_live_test", timeoutMs: 30_000, userAgent: "test",
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends shared storage as an explicit null, and a fixed size as a number", async () => {
    const calls: Array<{ method: string; url: string; body: string; key: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: String(init.method),
        url: String(url),
        body: String(init.body),
        key: (init.headers as Record<string, string>)["Idempotency-Key"],
      });
      return new Response(JSON.stringify({ data: { id: 9 } }), { status: 200 });
    }));
    const { handler } = register(realClient());

    await handler({ mailbox_id: 9, storage_allocation_mb: null, idempotency_key: "shared-9" });
    await handler({ mailbox_id: 9, storage_allocation_mb: 5120 });

    expect(calls[0]).toEqual({
      method: "PATCH",
      url: "https://trekmail.test/api/v1/mailboxes/9/storage",
      body: '{"storage_allocation_mb":null}',
      key: "shared-9",
    });
    expect(calls[1].body).toBe('{"storage_allocation_mb":5120}');
    expect(calls[1].key).toMatch(/^mcp_set_mailbox_storage_/);
  });

  it("requires the size, with null as a value, in the schema", () => {
    const { shape } = register({} as TrekMailClient);
    expect(shape.storage_allocation_mb.safeParse(undefined).success).toBe(false);
    expect(shape.storage_allocation_mb.safeParse(null).success).toBe(true);
    expect(shape.storage_allocation_mb.safeParse(1024).success).toBe(true);
    expect(shape.storage_allocation_mb.safeParse(0).success).toBe(false);
    expect(shape.storage_allocation_mb.safeParse(1.5).success).toBe(false);
    // The API refuses an Idempotency-Key over 255 characters; so does the
    // schema, as on the client-limit tools, instead of spending a round trip.
    expect(shape.idempotency_key.safeParse("k".repeat(255)).success).toBe(true);
    expect(shape.idempotency_key.safeParse("k".repeat(256)).success).toBe(false);
  });

  it("is blocked by the destructive gate", async () => {
    const setMailboxStorage = vi.fn();
    const { handler } = register({ setMailboxStorage } as unknown as TrekMailClient, false);

    const result = await handler({ mailbox_id: 9, storage_allocation_mb: 1024 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/destructive/i);
    expect(setMailboxStorage).not.toHaveBeenCalled();
  });

  it("reaches the agent with the client limit's numbers and the next step", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: "client_storage_below_usage",
        message: "This mailbox already uses 700 MB; choose at least that size.",
        hint: "Choose a size at least as large as what the mailbox already holds.",
        request_id: "req-1",
        retryable: false,
        details: { used_mb: 700, requested_mb: 500 },
      },
    }), { status: 422 })));
    const { handler } = register(realClient());

    const result = await handler({ mailbox_id: 9, storage_allocation_mb: 500 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("API Error [client_storage_below_usage]");
    expect(result.content[0].text).toContain("Action: Choose a fixed size of at least used_mb");
    expect(result.content[0].text).toContain('"used_mb":700');
  });
});
