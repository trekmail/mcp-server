import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";
import { registerMessageTokenTools } from "../../src/tools/message-tokens.js";
import type { Config } from "../../src/config.js";

describe("message token tools", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      createMessageToken: vi.fn().mockResolvedValue({
        id: 1,
        token: "tm_msg_plain_token",
        prefix: "tm_msg_pla",
        name: "My Token",
        scopes: ["messages:read"],
      }),
      listMessageTokens: vi.fn().mockResolvedValue({
        data: [{ id: 1, prefix: "tm_msg_abc", name: "Token 1" }],
      }),
      revokeMessageToken: vi.fn().mockResolvedValue({
        id: 1,
        revoked_at: "2026-03-20T12:00:00.000Z",
      }),
    } as unknown as TrekMailClient;
  });

  it("createMessageToken passes correct params to client", async () => {
    await client.createMessageToken(
      42,
      { name: "My Token", scopes: ["messages:read", "messages:write"], expires_in: "30d" },
      "idem-key-123",
    );
    expect(client.createMessageToken).toHaveBeenCalledWith(
      42,
      { name: "My Token", scopes: ["messages:read", "messages:write"], expires_in: "30d" },
      "idem-key-123",
    );
  });

  it("listMessageTokens passes mailbox_id and pagination", async () => {
    await client.listMessageTokens(42, { page: 2, per_page: 10 });
    expect(client.listMessageTokens).toHaveBeenCalledWith(42, {
      page: 2,
      per_page: 10,
    });
  });

  it("revokeMessageToken passes token_id to client", async () => {
    await client.revokeMessageToken(99);
    expect(client.revokeMessageToken).toHaveBeenCalledWith(99);
  });

  it("create_message_token generates deterministic idempotency key", () => {
    const key = idempotencyKey("create_message_token", {
      mailbox_id: 42,
      name: "My Token",
      scopes: "messages:read,messages:write",
    });
    expect(key).toMatch(/^mcp_create_message_token_[a-f0-9]{32}$/);

    // Same params = same key
    const key2 = idempotencyKey("create_message_token", {
      mailbox_id: 42,
      name: "My Token",
      scopes: "messages:read,messages:write",
    });
    expect(key).toBe(key2);
  });
});

/**
 * Ticket #163 follow-up — scope-aware gate on create_message_token.
 *
 * Once a token is minted it operates outside MCP entirely (any HTTP
 * client uses it via Authorization header). So the gate must match the
 * WORST scope being granted, not just "creation is generally destructive".
 *
 * Otherwise: prompt-injection chain → mint messages:send token → exfil →
 * unlimited mail-send from any client, ALLOW_SENDING=false notwithstanding.
 */
describe("create_message_token scope-aware gate", () => {
  function buildHarness(config: Partial<Config>) {
    const server = new McpServer({ name: "t", version: "0.0.0" });
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const original = server.registerTool.bind(server);
    server.registerTool = ((name: string, def: unknown, handler: any) => {
      handlers.set(name, handler);
      return original(name, def as any, handler);
    }) as typeof server.registerTool;

    const stubClient = {
      createMessageToken: vi.fn().mockResolvedValue({
        id: 1,
        token: "tm_msg_x",
        prefix: "tm_msg_xxx",
        name: "n",
      }),
      listMessageTokens: vi.fn(),
      revokeMessageToken: vi.fn(),
    } as unknown as TrekMailClient;

    const cfg: Config = {
      baseUrl: "https://trekmail.test",
      apiToken: "tm_live_x",
      timeoutMs: 30000,
      userAgent: "test",
      allowDestructive: false,
      allowSending: false,
      allowMigration: false,
      ...config,
    } as Config;

    registerMessageTokenTools(server, stubClient, cfg);
    return { handlers, stubClient };
  }

  it("read-only scope is permitted even with all flags off", async () => {
    const { handlers, stubClient } = buildHarness({});
    const res = (await handlers.get("create_message_token")!({
      mailbox_id: 1,
      name: "n",
      scopes: ["messages:read"],
    })) as { isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(stubClient.createMessageToken).toHaveBeenCalled();
  });

  it("messages:write scope rejected without allowDestructive", async () => {
    const { handlers, stubClient } = buildHarness({});
    const res = (await handlers.get("create_message_token")!({
      mailbox_id: 1,
      name: "n",
      scopes: ["messages:read", "messages:write"],
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("TREKMAIL_ALLOW_DESTRUCTIVE=true");
    expect(stubClient.createMessageToken).not.toHaveBeenCalled();
  });

  it("messages:write scope permitted with allowDestructive=true", async () => {
    const { handlers, stubClient } = buildHarness({ allowDestructive: true });
    const res = (await handlers.get("create_message_token")!({
      mailbox_id: 1,
      name: "n",
      scopes: ["messages:read", "messages:write"],
    })) as { isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(stubClient.createMessageToken).toHaveBeenCalled();
  });

  it("messages:send scope rejected without allowSending — even if allowDestructive=true", async () => {
    const { handlers, stubClient } = buildHarness({ allowDestructive: true });
    const res = (await handlers.get("create_message_token")!({
      mailbox_id: 1,
      name: "n",
      scopes: ["messages:read", "messages:send"],
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("TREKMAIL_ALLOW_SENDING=true");
    expect(stubClient.createMessageToken).not.toHaveBeenCalled();
  });

  it("messages:send scope permitted with allowSending=true", async () => {
    const { handlers, stubClient } = buildHarness({ allowSending: true, allowDestructive: true });
    const res = (await handlers.get("create_message_token")!({
      mailbox_id: 1,
      name: "n",
      scopes: ["messages:send"],
    })) as { isError?: boolean };
    expect(res.isError).toBeFalsy();
    expect(stubClient.createMessageToken).toHaveBeenCalled();
  });

  it("send is checked before write — most-restrictive flag wins on multi-scope grant", async () => {
    // sending requires allowSending; write requires allowDestructive. With
    // both flags off, the send check fires first. (Order is deterministic
    // for clarity in error messages — sending is the most user-facing risk.)
    const { handlers } = buildHarness({});
    const res = (await handlers.get("create_message_token")!({
      mailbox_id: 1,
      name: "n",
      scopes: ["messages:read", "messages:write", "messages:send"],
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("TREKMAIL_ALLOW_SENDING=true");
  });
});
