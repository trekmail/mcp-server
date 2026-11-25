import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";
import { registerInviteTools } from "../../src/tools/invites.js";

describe("invite tools", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      createInvite: vi.fn().mockResolvedValue({ id: 1, status: "pending" }),
      createInvitesBulk: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as TrekMailClient;
  });

  it("createInvite passes params to client", async () => {
    await client.createInvite(
      { domain_id: 1, local_part: "bob", recipient_email: "bob@gmail.com" },
      "idem-key",
    );
    expect(client.createInvite).toHaveBeenCalledWith(
      { domain_id: 1, local_part: "bob", recipient_email: "bob@gmail.com" },
      "idem-key",
    );
  });

  it("createInvitesBulk generates deterministic idempotency key", () => {
    const items = [{ local_part: "a", recipient_email: "a@b.com" }];
    const key = idempotencyKey("create_invites_bulk", {
      domain_id: 1,
      items,
      expires_in_hours: 72,
    });
    expect(key).toMatch(/^mcp_create_invites_bulk_/);
  });
});

/** Ticket #581: following an invite up — list, read, resend and cancel. */
describe("invite follow-up tools", () => {
  const config = (changes: Partial<Config> = {}): Config => ({
    baseUrl: "https://test.invalid",
    apiToken: "tm_live_test",
    timeoutMs: 30_000,
    userAgent: "test",
    allowDestructive: true,
    allowSending: true,
    allowMigration: false,
    scopeAwareRegistration: true,
    readOnly: false,
    httpTransport: false,
    ...changes,
  });

  function harness(cfg: Config) {
    const calls: Array<{ method: string; url: string; body: string | undefined; key: string | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: String(init.method),
        url: String(url),
        body: init.body === undefined ? undefined : String(init.body),
        key: (init.headers as Record<string, string>)["Idempotency-Key"],
      });
      return new Response(JSON.stringify({ invite_id: 5, status: "pending" }), { status: 200 });
    }));
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
    const original = server.registerTool.bind(server);
    server.registerTool = ((name: string, definition: unknown, handler: never) => {
      handlers.set(name, handler);
      return original(name, definition as Parameters<typeof original>[1], handler);
    }) as typeof server.registerTool;
    registerInviteTools(server, new TrekMailClient({
      baseUrl: "https://trekmail.test", token: "tm_live_test", timeoutMs: 30_000, userAgent: "test",
    }), cfg);
    return { calls, handlers };
  }

  afterEach(() => vi.unstubAllGlobals());

  it("sends each call to its REST route, with an Idempotency-Key on writes", async () => {
    const { calls, handlers } = harness(config());

    await handlers.get("list_invites")!({ domain_id: 7, status: "expired", per_page: 10 });
    await handlers.get("get_invite")!({ invite_id: 5 });
    await handlers.get("resend_invite")!({ invite_id: 5, idempotency_key: "k1" });
    await handlers.get("cancel_invite")!({ invite_id: 5, confirm_cancel: true, idempotency_key: "k2" });

    expect(calls).toEqual([
      { method: "GET", url: "https://trekmail.test/api/v1/mailboxes/invites?domain_id=7&status=expired&per_page=10", body: undefined, key: undefined },
      { method: "GET", url: "https://trekmail.test/api/v1/mailboxes/invites/5", body: undefined, key: undefined },
      { method: "POST", url: "https://trekmail.test/api/v1/mailboxes/invites/5:resend", body: undefined, key: "k1" },
      { method: "DELETE", url: "https://trekmail.test/api/v1/mailboxes/invites/5", body: undefined, key: "k2" },
    ]);
  });

  it("resends only with sending allowed, and a repeat without a key replays", async () => {
    const off = harness(config({ allowSending: false }));
    const refused = await off.handlers.get("resend_invite")!({ invite_id: 5 });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("TREKMAIL_ALLOW_SENDING");
    expect(off.calls).toEqual([]);

    const on = harness(config());
    await on.handlers.get("resend_invite")!({ invite_id: 5 });
    await on.handlers.get("resend_invite")!({ invite_id: 5 });
    expect(on.calls).toHaveLength(2);
    expect(on.calls[0].key).toBe(on.calls[1].key);
    expect(on.calls[0].key).toMatch(/^mcp_resend_invite_/);
  });

  it("cancels only with destructive operations allowed and confirm_cancel", async () => {
    const off = harness(config({ allowDestructive: false }));
    const refused = await off.handlers.get("cancel_invite")!({ invite_id: 5, confirm_cancel: true });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("TREKMAIL_ALLOW_DESTRUCTIVE");

    const on = harness(config());
    const unconfirmed = await on.handlers.get("cancel_invite")!({ invite_id: 5, confirm_cancel: false });
    expect(unconfirmed.isError).toBe(true);
    expect(off.calls).toEqual([]);
    expect(on.calls).toEqual([]);
  });

  it("states the 7-day default expiry", () => {
    const source = readFileSync(fileURLToPath(new URL("../../src/tools/invites.ts", import.meta.url)), "utf8");
    expect(source).not.toContain("default: 72");
    expect(source.match(/default: 168, i\.e\. 7 days/g)).toHaveLength(2);
  });
});
