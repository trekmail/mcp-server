import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import { TrekMailClient } from "../../src/client.js";
import { registerMessageIdentityTools } from "../../src/tools/message-identities.js";

const cfg = (allowDestructive: boolean): Config => ({
  baseUrl: "https://test.invalid",
  messageToken: "tm_msg_test",
  timeoutMs: 30_000,
  userAgent: "test",
  allowDestructive,
  allowSending: false,
  allowMigration: false,
});

function harness(config: Config) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    listIdentities: vi.fn().mockResolvedValue({ identities: [] }),
    createIdentity: vi.fn().mockResolvedValue({ identity: { id: 1 } }),
    updateIdentity: vi.fn().mockResolvedValue({ identity: { id: 1 } }),
    deleteIdentity: vi.fn().mockResolvedValue({}),
    setReplyFromPolicy: vi.fn().mockResolvedValue({ reply_from_policy: "recipient" }),
  } as unknown as TrekMailClient;
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
  const original = server.registerTool.bind(server);
  server.registerTool = ((name: string, definition: unknown, handler: never) => {
    handlers.set(name, handler);
    return original(name, definition as Parameters<typeof original>[1], handler);
  }) as typeof server.registerTool;

  registerMessageIdentityTools(server, client, config);
  return { server, client, handlers };
}

describe("message identity tools", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness(cfg(true));
  });

  it("lists addresses for one connected inbox", async () => {
    await h.handlers.get("list_identities")!({ external_account_id: 11 });
    expect(h.client.listIdentities).toHaveBeenCalledWith({ external_account_id: 11 });
  });

  it("creates a source-bound Send As identity with its SMTP route", async () => {
    await h.handlers.get("create_identity")!({
      kind: "send_as",
      email: "sales@example.com",
      external_account_id: 11,
      smtp_mode: "profile",
      smtp_connection_id: 7,
      idempotency_key: "idem-create",
    });

    expect(h.client.createIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "send_as",
        external_account_id: 11,
        smtp_connection_id: 7,
      }),
      "idem-create",
    );
  });

  it("requires the connected source for a Send As identity", async () => {
    const result = await h.handlers.get("create_identity")!({
      kind: "send_as",
      email: "sales@example.com",
    }) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(h.client.createIdentity).not.toHaveBeenCalled();
  });

  it("updates and deletes against the exact connected source", async () => {
    await h.handlers.get("update_identity")!({ id: 4, external_account_id: 11, name: "Sales" });
    expect(h.client.updateIdentity).toHaveBeenCalledWith(
      4,
      { external_account_id: 11, name: "Sales" },
      expect.any(String),
    );

    await h.handlers.get("delete_identity")!({ id: 4, external_account_id: 11 });
    expect(h.client.deleteIdentity).toHaveBeenCalledWith(4, 11);
  });

  it("sets the reply From policy", async () => {
    await h.handlers.get("set_reply_from_policy")!({
      reply_from_policy: "recipient",
      idempotency_key: "idem-policy",
    });
    expect(h.client.setReplyFromPolicy).toHaveBeenCalledWith("recipient", "idem-policy");
  });

  it("blocks all mutations when destructive operations are disabled", async () => {
    const blocked = harness(cfg(false));
    for (const [name, args] of [
      ["create_identity", { email: "sales@example.com" }],
      ["update_identity", { id: 4, name: "Sales" }],
      ["delete_identity", { id: 4 }],
      ["set_reply_from_policy", { reply_from_policy: "default" }],
    ] as const) {
      const result = await blocked.handlers.get(name)!({ ...args }) as { isError?: boolean };
      expect(result.isError, name).toBe(true);
    }
  });
});
