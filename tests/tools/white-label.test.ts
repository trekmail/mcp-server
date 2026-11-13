import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";
import { registerWhiteLabelTools } from "../../src/tools/white-label.js";

// The real key function, watched: set_client_limit gets a fresh key per call
// (a repeatable operation), so what it was computed from is only visible here.
vi.mock("../../src/idempotency.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/idempotency.js")>();
  return { ...actual, idempotencyKey: vi.fn(actual.idempotencyKey) };
});

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

function harness(cfg: Config, realClient?: TrekMailClient) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = realClient ?? {
    getWhiteLabel: vi.fn().mockResolvedValue({ ok: true }),
    getWhiteLabelAccessCatalog: vi.fn().mockResolvedValue({ ok: true }),
    listWhiteLabelMembers: vi.fn().mockResolvedValue({ ok: true }),
    getWhiteLabelMember: vi.fn().mockResolvedValue({ ok: true }),
    inviteWhiteLabelMember: vi.fn().mockResolvedValue({ ok: true }),
    updateWhiteLabelMember: vi.fn().mockResolvedValue({ ok: true }),
    suspendWhiteLabelMember: vi.fn().mockResolvedValue({ ok: true }),
    resumeWhiteLabelMember: vi.fn().mockResolvedValue({ ok: true }),
    resendWhiteLabelInvitation: vi.fn().mockResolvedValue({ ok: true }),
    removeWhiteLabelMember: vi.fn().mockResolvedValue({ ok: true }),
    restoreWhiteLabelMember: vi.fn().mockResolvedValue({ ok: true }),
    listWhiteLabelActivity: vi.fn().mockResolvedValue({ ok: true }),
    getWhiteLabelMemberActivity: vi.fn().mockResolvedValue({ ok: true }),
    listClientLimits: vi.fn().mockResolvedValue({ ok: true }),
    setClientLimit: vi.fn().mockResolvedValue({ ok: true }),
    updateClientLimit: vi.fn().mockResolvedValue({ ok: true }),
    removeClientLimit: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as TrekMailClient;
  const handlers = new Map<
    string,
    (args: Record<string, unknown>) => Promise<{
      isError?: boolean;
      content: Array<{ text: string }>;
    }>
  >();
  const original = server.registerTool.bind(server);
  server.registerTool = ((name: string, definition: unknown, handler: never) => {
    handlers.set(name, handler);
    return original(name, definition as Parameters<typeof original>[1], handler);
  }) as typeof server.registerTool;

  registerWhiteLabelTools(server, client, cfg);

  return { server, client, handlers };
}

describe("White Label tools", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness(config());
  });

  it("registers all 16 account, member, client limit, and activity tools", () => {
    const tools = (h.server as unknown as {
      _registeredTools: Record<string, unknown>;
    })._registeredTools;
    expect(Object.keys(tools)).toHaveLength(16);
    expect(tools.get_white_label).toBeDefined();
    expect(tools.invite_white_label_member).toBeDefined();
    expect(tools.get_white_label_member_activity).toBeDefined();
    expect(tools.list_client_limits).toBeDefined();
    expect(tools.set_client_limit).toBeDefined();
    expect(tools.remove_client_limit).toBeDefined();
  });

  it("forwards member filters to the API client", async () => {
    await h.handlers.get("list_white_label_members")!({
      role: "client",
      status: "active",
      page: 2,
    });
    expect(h.client.listWhiteLabelMembers).toHaveBeenCalledWith({
      role: "client",
      status: "active",
      page: 2,
    });
  });

  it("can filter historical roles without offering them for assignment", () => {
    const tools = (h.server as unknown as {
      _registeredTools: Record<string, {
        inputSchema: {
          shape: Record<string, { safeParse(value: unknown): { success: boolean } }>;
        };
      }>;
    })._registeredTools;

    expect(tools.list_white_label_members.inputSchema.shape.role.safeParse("owner").success).toBe(true);
    expect(tools.list_white_label_members.inputSchema.shape.role.safeParse("support_agent").success).toBe(true);
    expect(tools.invite_white_label_member.inputSchema.shape.role.safeParse("owner").success).toBe(false);
    expect(tools.update_white_label_member.inputSchema.shape.role.safeParse("support_agent").success).toBe(false);
  });

  it("uses stable idempotency and keeps it out of the request body", async () => {
    await h.handlers.get("invite_white_label_member")!({
      email: "client@example.test",
      role: "client",
      all_domains: false,
      domain_ids: [7],
      idempotency_key: "invite-client-7",
    });
    expect(h.client.inviteWhiteLabelMember).toHaveBeenCalledWith({
      email: "client@example.test",
      role: "client",
      all_domains: false,
      domain_ids: [7],
    }, "invite-client-7");
  });

  it("requires the sending gate for invite and resend", async () => {
    const guarded = harness(config({ allowSending: false }));

    const invite = await guarded.handlers.get("invite_white_label_member")!({
      email: "client@example.test",
      role: "client",
      all_domains: false,
      domain_ids: [7],
    });
    const resend = await guarded.handlers.get("resend_white_label_invitation")!({
      member_id: 12,
    });

    expect(invite.isError).toBe(true);
    expect(resend.isError).toBe(true);
    expect(guarded.client.inviteWhiteLabelMember).not.toHaveBeenCalled();
    expect(guarded.client.resendWhiteLabelInvitation).not.toHaveBeenCalled();
  });

  it("requires the destructive gate and explicit confirmation for removal", async () => {
    const guarded = harness(config({ allowDestructive: false }));
    const disabled = await guarded.handlers.get("remove_white_label_member")!({
      member_id: 12,
      confirm_remove: true,
    });
    expect(disabled.isError).toBe(true);

    const unconfirmed = await h.handlers.get("remove_white_label_member")!({
      member_id: 12,
      confirm_remove: false,
    });
    expect(unconfirmed.isError).toBe(true);
    expect(h.client.removeWhiteLabelMember).not.toHaveBeenCalled();
  });

  it("rejects an empty member update before calling the API", async () => {
    const result = await h.handlers.get("update_white_label_member")!({ member_id: 12 });
    expect(result.isError).toBe(true);
    expect(h.client.updateWhiteLabelMember).not.toHaveBeenCalled();
  });
});

type Schema = { safeParse(value: unknown): { success: boolean } };
const schemaOf = (server: McpServer, name: string) =>
  (server as unknown as {
    _registeredTools: Record<string, { inputSchema: { shape: Record<string, Schema> } }>;
  })._registeredTools[name].inputSchema.shape;

/** Ticket #482: one storage budget for a White Label client's domains. */
describe("White Label client storage limit tools", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness(config());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists limits with paging passed through, read-only and ungated", async () => {
    const guarded = harness(config({ allowDestructive: false }));
    const result = await guarded.handlers.get("list_client_limits")!({ page: 2, per_page: 50 });

    expect(result.isError).toBeUndefined();
    expect(guarded.client.listClientLimits).toHaveBeenCalledWith({ page: 2, per_page: 50 });
  });

  it("sets a limit by domains with POST, keeping the key out of the body", async () => {
    await h.handlers.get("set_client_limit")!({
      domain_ids: [7, 8],
      storage_limit_mb: 51200,
      idempotency_key: "client-7-50gb",
    });

    expect(h.client.setClientLimit).toHaveBeenCalledWith(
      { domain_ids: [7, 8], storage_limit_mb: 51200 },
      "client-7-50gb",
    );
    expect(h.client.updateClientLimit).not.toHaveBeenCalled();
  });

  it("changes a limit by id with only the fields given", async () => {
    await h.handlers.get("set_client_limit")!({ client_limit_id: 4, domain_ids: [7] });
    await h.handlers.get("set_client_limit")!({ client_limit_id: 4, storage_limit_mb: 1024 });

    expect(h.client.updateClientLimit).toHaveBeenNthCalledWith(
      1, 4, { domain_ids: [7] }, expect.stringMatching(/^mcp_set_client_limit_/),
    );
    expect(h.client.updateClientLimit).toHaveBeenNthCalledWith(
      2, 4, { storage_limit_mb: 1024 }, expect.stringMatching(/^mcp_set_client_limit_/),
    );
    expect(h.client.setClientLimit).not.toHaveBeenCalled();
  });

  it("refuses an incomplete change before calling the API", async () => {
    const domainsOnly = await h.handlers.get("set_client_limit")!({ domain_ids: [7] });
    const sizeOnly = await h.handlers.get("set_client_limit")!({ storage_limit_mb: 1024 });
    const idOnly = await h.handlers.get("set_client_limit")!({ client_limit_id: 4 });

    for (const result of [domainsOnly, sizeOnly, idOnly]) {
      expect(result.isError).toBe(true);
    }
    expect(h.client.setClientLimit).not.toHaveBeenCalled();
    expect(h.client.updateClientLimit).not.toHaveBeenCalled();
  });

  it("requires the destructive gate to set or remove, and confirmation to remove", async () => {
    const guarded = harness(config({ allowDestructive: false }));
    const set = await guarded.handlers.get("set_client_limit")!({ domain_ids: [7], storage_limit_mb: 1024 });
    const removed = await guarded.handlers.get("remove_client_limit")!({ client_limit_id: 4, confirm_remove: true });
    expect(set.isError).toBe(true);
    expect(removed.isError).toBe(true);
    expect(guarded.client.setClientLimit).not.toHaveBeenCalled();
    expect(guarded.client.removeClientLimit).not.toHaveBeenCalled();

    const unconfirmed = await h.handlers.get("remove_client_limit")!({ client_limit_id: 4, confirm_remove: false });
    expect(unconfirmed.isError).toBe(true);
    expect(h.client.removeClientLimit).not.toHaveBeenCalled();

    await h.handlers.get("remove_client_limit")!({ client_limit_id: 4, confirm_remove: true, idempotency_key: "rm-4" });
    expect(h.client.removeClientLimit).toHaveBeenCalledWith(4, "rm-4");
  });

  it("applies a size set again after a change instead of replaying the first answer", async () => {
    // 50 GB, then 20 GB, then 50 GB again: the third call is a new operation.
    for (const size of [51200, 20480, 51200]) {
      await h.handlers.get("set_client_limit")!({ domain_ids: [7], storage_limit_mb: size });
    }
    const keys = vi.mocked(h.client.setClientLimit).mock.calls.map(([, key]) => key);
    expect(new Set(keys).size).toBe(3);
  });

  it("validates sizes and domains in the schema", () => {
    const shape = schemaOf(h.server, "set_client_limit");
    expect(shape.storage_limit_mb.safeParse(0).success).toBe(false);
    expect(shape.storage_limit_mb.safeParse(2147483648).success).toBe(false);
    expect(shape.storage_limit_mb.safeParse(2147483647).success).toBe(true);
    expect(shape.domain_ids.safeParse([]).success).toBe(false);
    expect(shape.domain_ids.safeParse([7]).success).toBe(true);
    expect(schemaOf(h.server, "remove_client_limit").confirm_remove.safeParse(undefined).success).toBe(false);
  });

  it("sends each call to its REST route with an Idempotency-Key on writes", async () => {
    const calls: Array<{ method: string; url: string; body: string | undefined; key: string | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        method: String(init.method),
        url: String(url),
        body: init.body === undefined ? undefined : String(init.body),
        key: (init.headers as Record<string, string>)["Idempotency-Key"],
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const { handlers } = harness(config(), new TrekMailClient({
      baseUrl: "https://trekmail.test", token: "tm_live_test", timeoutMs: 30_000, userAgent: "test",
    }));

    await handlers.get("list_client_limits")!({ per_page: 10 });
    await handlers.get("set_client_limit")!({ domain_ids: [7], storage_limit_mb: 1024, idempotency_key: "k1" });
    await handlers.get("set_client_limit")!({ client_limit_id: 4, domain_ids: [7, 9], idempotency_key: "k2" });
    await handlers.get("remove_client_limit")!({ client_limit_id: 4, confirm_remove: true, idempotency_key: "k3" });

    expect(calls).toEqual([
      { method: "GET", url: "https://trekmail.test/api/v1/white-label/client-limits?per_page=10", body: undefined, key: undefined },
      { method: "POST", url: "https://trekmail.test/api/v1/white-label/client-limits", body: '{"domain_ids":[7],"storage_limit_mb":1024}', key: "k1" },
      { method: "PATCH", url: "https://trekmail.test/api/v1/white-label/client-limits/4", body: '{"domain_ids":[7,9]}', key: "k2" },
      { method: "DELETE", url: "https://trekmail.test/api/v1/white-label/client-limits/4", body: undefined, key: "k3" },
    ]);
  });
});

/** Ticket #547, plan §8: the client's mailbox maximum and mailbox size on set_client_limit. */
describe("White Label client mailbox caps", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness(config());
    vi.mocked(idempotencyKey).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the caps with a new limit, and leaves out the ones not given", async () => {
    await h.handlers.get("set_client_limit")!({
      domain_ids: [7], storage_limit_mb: 5120, max_mailboxes: 5, mailbox_size_mb: 1024, idempotency_key: "k-caps",
    });
    await h.handlers.get("set_client_limit")!({ domain_ids: [8], storage_limit_mb: 5120, mailbox_size_mb: null });

    expect(h.client.setClientLimit).toHaveBeenNthCalledWith(
      1, { domain_ids: [7], storage_limit_mb: 5120, max_mailboxes: 5, mailbox_size_mb: 1024 }, "k-caps",
    );
    expect(h.client.setClientLimit).toHaveBeenNthCalledWith(
      2, { domain_ids: [8], storage_limit_mb: 5120, mailbox_size_mb: null }, expect.stringMatching(/^mcp_set_client_limit_/),
    );
  });

  it("changes a limit with only a cap, null included, and nothing else", async () => {
    const removed = await h.handlers.get("set_client_limit")!({ client_limit_id: 4, max_mailboxes: null });
    await h.handlers.get("set_client_limit")!({ client_limit_id: 4, mailbox_size_mb: 2048 });
    await h.handlers.get("set_client_limit")!({ client_limit_id: 4, storage_limit_mb: 10240, max_mailboxes: 3, mailbox_size_mb: null });

    expect(removed.isError).toBeUndefined();
    expect(h.client.updateClientLimit).toHaveBeenNthCalledWith(
      1, 4, { max_mailboxes: null }, expect.stringMatching(/^mcp_set_client_limit_/),
    );
    expect(h.client.updateClientLimit).toHaveBeenNthCalledWith(
      2, 4, { mailbox_size_mb: 2048 }, expect.stringMatching(/^mcp_set_client_limit_/),
    );
    expect(h.client.updateClientLimit).toHaveBeenNthCalledWith(
      3, 4, { storage_limit_mb: 10240, max_mailboxes: 3, mailbox_size_mb: null }, expect.stringMatching(/^mcp_set_client_limit_/),
    );

    // A caps value never makes an incomplete new limit complete.
    const capsOnly = await h.handlers.get("set_client_limit")!({ domain_ids: [7], max_mailboxes: 5 });
    expect(capsOnly.isError).toBe(true);
    expect(h.client.setClientLimit).not.toHaveBeenCalled();
  });

  it("computes the idempotency key from the caps too", async () => {
    await h.handlers.get("set_client_limit")!({ domain_ids: [7], storage_limit_mb: 5120, max_mailboxes: 5 });
    await h.handlers.get("set_client_limit")!({ client_limit_id: 4, max_mailboxes: null, mailbox_size_mb: 1024 });

    const keyed = vi.mocked(idempotencyKey).mock.calls.filter(([tool]) => tool === "set_client_limit");
    expect(keyed.map(([, params]) => params)).toEqual([
      { domain_ids: [7], storage_limit_mb: 5120, max_mailboxes: 5 },
      { client_limit_id: 4, max_mailboxes: null, mailbox_size_mb: 1024 },
    ]);
  });

  it("validates the caps in the schema: optional, nullable, within the API's bounds", () => {
    const shape = schemaOf(h.server, "set_client_limit");
    for (const [value, ok] of [[undefined, true], [null, true], [1, true], [100000, true], [0, false], [100001, false], [2.5, false], ["5", false]] as const) {
      expect(shape.max_mailboxes.safeParse(value).success, `max_mailboxes ${String(value)}`).toBe(ok);
    }
    for (const [value, ok] of [[undefined, true], [null, true], [1, true], [2147483647, true], [0, false], [2147483648, false], [1.5, false]] as const) {
      expect(shape.mailbox_size_mb.safeParse(value).success, `mailbox_size_mb ${String(value)}`).toBe(ok);
    }
  });

  it("describes the caps where an agent reads set_client_limit and list_client_limits", () => {
    const tools = (h.server as unknown as {
      _registeredTools: Record<string, { description: string }>;
    })._registeredTools;

    expect(tools.set_client_limit.description).toContain("max_mailboxes");
    expect(tools.set_client_limit.description).toContain("mailbox_size_mb");
    expect(tools.set_client_limit.description).toContain("existing mailboxes keep working");
    expect(tools.list_client_limits.description).toContain("max_mailboxes, mailbox_size_mb");
    expect(tools.list_client_limits.description).toContain("pending_invites");
  });

  it("sends null as JSON null to the REST route", async () => {
    const calls: Array<{ method: string; url: string; body: string | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url: String(url), body: init.body === undefined ? undefined : String(init.body) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const { handlers } = harness(config(), new TrekMailClient({
      baseUrl: "https://trekmail.test", token: "tm_live_test", timeoutMs: 30_000, userAgent: "test",
    }));

    await handlers.get("set_client_limit")!({ domain_ids: [7], storage_limit_mb: 5120, max_mailboxes: 5, mailbox_size_mb: 1024, idempotency_key: "c1" });
    await handlers.get("set_client_limit")!({ client_limit_id: 4, max_mailboxes: null, idempotency_key: "c2" });

    expect(calls).toEqual([
      { method: "POST", url: "https://trekmail.test/api/v1/white-label/client-limits", body: '{"domain_ids":[7],"storage_limit_mb":5120,"max_mailboxes":5,"mailbox_size_mb":1024}' },
      { method: "PATCH", url: "https://trekmail.test/api/v1/white-label/client-limits/4", body: '{"max_mailboxes":null}' },
    ]);
  });
});
