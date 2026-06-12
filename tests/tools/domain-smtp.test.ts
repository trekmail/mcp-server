import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import { registerDomainSmtpTools } from "../../src/tools/domain-smtp.js";
import type { Config } from "../../src/config.js";

const cfg = (allowDestructive: boolean): Config => ({
  baseUrl: "x",
  apiToken: "x",
  timeoutMs: 30_000,
  userAgent: "test",
  allowDestructive,
  allowSending: false,
  allowMigration: false,
});

function harness(config: Config) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    getDomainSmtp: vi.fn().mockResolvedValue({ data: { smtp_mode: "platform" } }),
    setDomainSmtp: vi.fn().mockResolvedValue({ data: { smtp_mode: "profile" } }),
    listDomainSmtpProfiles: vi.fn().mockResolvedValue({ data: [] }),
    createDomainSmtpProfile: vi.fn().mockResolvedValue({ data: {} }),
    updateDomainSmtpProfile: vi.fn().mockResolvedValue({ data: {} }),
    deleteDomainSmtpProfile: vi.fn().mockResolvedValue({ data: { deleted: true } }),
    testDomainSmtp: vi.fn().mockResolvedValue({ data: { job_id: "j1" } }),
    getDomainSmtpTestStatus: vi.fn().mockResolvedValue({ data: { status: "success" } }),
    getAccountSmtpDefault: vi.fn().mockResolvedValue({ data: { default_smtp_mode: "platform" } }),
    setAccountSmtpDefault: vi.fn().mockResolvedValue({ data: { default_smtp_mode: "profile" } }),
  } as unknown as TrekMailClient;

  const handlers = new Map<string, (a: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
  const orig = server.registerTool.bind(server);
  server.registerTool = ((name: string, def: unknown, h: never) => {
    handlers.set(name, h);
    return orig(name, def as Parameters<typeof orig>[1], h);
  }) as typeof server.registerTool;

  registerDomainSmtpTools(server, client, config);
  return { server, client, handlers };
}

describe("domain SMTP tools", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness(cfg(true));
  });

  it("registers all per-domain + account-default SMTP tools", () => {
    const tools = (h.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    for (const name of [
      "get_domain_smtp", "set_domain_smtp", "list_domain_smtp_profiles",
      "create_domain_smtp_profile", "update_domain_smtp_profile",
      "delete_domain_smtp_profile", "test_domain_smtp", "get_domain_smtp_test_status",
      "get_account_smtp_default", "set_account_smtp_default",
    ]) {
      expect(tools[name]).toBeDefined();
    }
  });

  it("read tools have no destructive hint; write/test tools do", () => {
    const tools = (h.server as unknown as { _registeredTools: Record<string, { annotations?: { destructiveHint?: boolean } }> })._registeredTools;
    expect(tools.get_domain_smtp.annotations?.destructiveHint).toBeFalsy();
    expect(tools.list_domain_smtp_profiles.annotations?.destructiveHint).toBeFalsy();
    expect(tools.get_domain_smtp_test_status.annotations?.destructiveHint).toBeFalsy();
    for (const name of ["set_domain_smtp", "create_domain_smtp_profile", "update_domain_smtp_profile", "delete_domain_smtp_profile", "test_domain_smtp"]) {
      expect(tools[name].annotations?.destructiveHint).toBe(true);
    }
  });

  it("get_domain_smtp calls the client", async () => {
    await h.handlers.get("get_domain_smtp")!({ domain_id: 7 });
    expect(h.client.getDomainSmtp).toHaveBeenCalledWith(7);
  });

  it("set_domain_smtp forwards mode + profile id when allowed", async () => {
    await h.handlers.get("set_domain_smtp")!({ domain_id: 7, smtp_mode: "profile", smtp_connection_id: 3 });
    expect(h.client.setDomainSmtp).toHaveBeenCalledWith(7, expect.objectContaining({ smtp_mode: "profile", smtp_connection_id: 3 }), expect.any(String));
  });

  it("set_domain_smtp is blocked when allowDestructive=false", async () => {
    const gated = harness(cfg(false));
    const result = await gated.handlers.get("set_domain_smtp")!({ domain_id: 7, smtp_mode: "platform" });
    expect(result.isError).toBe(true);
    expect(gated.client.setDomainSmtp).not.toHaveBeenCalled();
  });

  it("create_domain_smtp_profile rejects private hosts", async () => {
    const result = await h.handlers.get("create_domain_smtp_profile")!({
      domain_id: 7, name: "x", host: "127.0.0.1", port: 587, encryption: "tls", username: "u", password: "p",
    });
    expect(result.isError).toBe(true);
    expect(h.client.createDomainSmtpProfile).not.toHaveBeenCalled();
  });

  it("get_account_smtp_default is read-only and calls the client", async () => {
    const tools = (h.server as unknown as { _registeredTools: Record<string, { annotations?: { destructiveHint?: boolean } }> })._registeredTools;
    expect(tools.get_account_smtp_default.annotations?.destructiveHint).toBeFalsy();
    await h.handlers.get("get_account_smtp_default")!({});
    expect(h.client.getAccountSmtpDefault).toHaveBeenCalled();
  });

  it("set_account_smtp_default forwards mode + apply_to_all (destructive, gated)", async () => {
    const tools = (h.server as unknown as { _registeredTools: Record<string, { annotations?: { destructiveHint?: boolean } }> })._registeredTools;
    expect(tools.set_account_smtp_default.annotations?.destructiveHint).toBe(true);
    await h.handlers.get("set_account_smtp_default")!({ smtp_mode: "profile", smtp_connection_id: 3, apply_to_all: true });
    expect(h.client.setAccountSmtpDefault).toHaveBeenCalledWith(
      expect.objectContaining({ smtp_mode: "profile", smtp_connection_id: 3, apply_to_all: true }),
      expect.any(String),
    );

    const gated = harness(cfg(false));
    const result = await gated.handlers.get("set_account_smtp_default")!({ smtp_mode: "platform" });
    expect(result.isError).toBe(true);
    expect(gated.client.setAccountSmtpDefault).not.toHaveBeenCalled();
  });
});
