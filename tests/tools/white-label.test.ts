import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import type { TrekMailClient } from "../../src/client.js";
import { registerWhiteLabelTools } from "../../src/tools/white-label.js";

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
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
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

  it("registers all 13 account, member, and activity tools", () => {
    const tools = (h.server as unknown as {
      _registeredTools: Record<string, unknown>;
    })._registeredTools;
    expect(Object.keys(tools)).toHaveLength(13);
    expect(tools.get_white_label).toBeDefined();
    expect(tools.invite_white_label_member).toBeDefined();
    expect(tools.get_white_label_member_activity).toBeDefined();
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
