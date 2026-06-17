import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import { registerBrandingTools } from "../../src/tools/branding.js";
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
    getDomainBranding: vi.fn().mockResolvedValue({ data: { mode: "custom" } }),
    setDomainBranding: vi.fn().mockResolvedValue({ data: { mode: "custom" } }),
    verifyDomainBrandingDns: vi.fn().mockResolvedValue({ data: { status: "queued" } }),
    createBrandingPreview: vi.fn().mockResolvedValue({ data: { url: "https://x.preview/app" } }),
    removeDomainBranding: vi.fn().mockResolvedValue({ data: { mode: "off" } }),
    setDomainBrandLogo: vi.fn().mockResolvedValue({ data: {} }),
    removeDomainBrandLogo: vi.fn().mockResolvedValue({ data: {} }),
  } as unknown as TrekMailClient;

  const handlers = new Map<string, (a: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
  const orig = server.registerTool.bind(server);
  server.registerTool = ((name: string, def: unknown, h: never) => {
    handlers.set(name, h);
    return orig(name, def as Parameters<typeof orig>[1], h);
  }) as typeof server.registerTool;

  registerBrandingTools(server, client, config);
  return { server, client, handlers };
}

describe("branding tools", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness(cfg(true));
  });

  it("registers all 7 branding tools", () => {
    const tools = (h.server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    for (const name of [
      "get_domain_branding", "set_domain_branding", "set_domain_brand_logo",
      "verify_domain_branding_dns", "create_branding_preview",
      "remove_domain_brand_logo", "remove_domain_branding",
    ]) {
      expect(tools[name]).toBeDefined();
    }
  });

  it("the read tool carries no annotations; every mutator is destructive (parity with signature/smtp)", () => {
    const tools = (h.server as unknown as { _registeredTools: Record<string, { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }> })._registeredTools;
    expect(tools.get_domain_branding.annotations?.destructiveHint).toBeFalsy();
    expect(tools.get_domain_branding.annotations?.readOnlyHint).toBeFalsy();
    for (const name of [
      "set_domain_branding", "set_domain_brand_logo", "verify_domain_branding_dns",
      "create_branding_preview", "remove_domain_brand_logo", "remove_domain_branding",
    ]) {
      expect(tools[name].annotations?.destructiveHint).toBe(true);
    }
  });

  it("get_domain_branding calls the client", async () => {
    await h.handlers.get("get_domain_branding")!({ domain_id: 7 });
    expect(h.client.getDomainBranding).toHaveBeenCalledWith(7);
  });

  it("set_domain_branding strips undefined fields and forwards the rest", async () => {
    await h.handlers.get("set_domain_branding")!({
      domain_id: 7,
      mode: "custom",
      name: "Acme",
      primary_color: "#dc2626",
      dashboard_enabled: true,
      scope: "domain",
    });
    expect(h.client.setDomainBranding).toHaveBeenCalledWith(7, {
      mode: "custom",
      name: "Acme",
      primary_color: "#dc2626",
      dashboard_enabled: true,
      scope: "domain",
    });
  });

  it("set_domain_branding forwards an explicit null (clear)", async () => {
    await h.handlers.get("set_domain_branding")!({
      domain_id: 7,
      support_email: null,
    });
    expect(h.client.setDomainBranding).toHaveBeenCalledWith(7, { support_email: null });
  });

  it("set_domain_brand_logo passes slot + base64", async () => {
    await h.handlers.get("set_domain_brand_logo")!({
      domain_id: 7,
      slot: "light",
      content_base64: "AAAA",
    });
    expect(h.client.setDomainBrandLogo).toHaveBeenCalledWith(7, "light", "AAAA");
  });

  it("verify_domain_branding_dns calls the client", async () => {
    await h.handlers.get("verify_domain_branding_dns")!({ domain_id: 7 });
    expect(h.client.verifyDomainBrandingDns).toHaveBeenCalledWith(7);
  });

  it("create_branding_preview calls the client", async () => {
    await h.handlers.get("create_branding_preview")!({ domain_id: 7 });
    expect(h.client.createBrandingPreview).toHaveBeenCalledWith(7);
  });

  it("every mutator is gated behind allowDestructive (read is not)", async () => {
    const guarded = harness(cfg(false));

    // The read tool still works without the flag.
    await guarded.handlers.get("get_domain_branding")!({ domain_id: 7 });
    expect(guarded.client.getDomainBranding).toHaveBeenCalledWith(7);

    const mutators: Array<[string, Record<string, unknown>, keyof TrekMailClient]> = [
      ["set_domain_branding", { domain_id: 7, mode: "custom" }, "setDomainBranding"],
      ["set_domain_brand_logo", { domain_id: 7, slot: "light", content_base64: "AA" }, "setDomainBrandLogo"],
      ["verify_domain_branding_dns", { domain_id: 7 }, "verifyDomainBrandingDns"],
      ["create_branding_preview", { domain_id: 7 }, "createBrandingPreview"],
      ["remove_domain_brand_logo", { domain_id: 7, slot: "light" }, "removeDomainBrandLogo"],
      ["remove_domain_branding", { domain_id: 7, scope: "all" }, "removeDomainBranding"],
    ];
    for (const [tool, args, clientMethod] of mutators) {
      const r = await guarded.handlers.get(tool)!(args);
      expect(r.isError, `${tool} must be gated`).toBe(true);
      expect(guarded.client[clientMethod]).not.toHaveBeenCalled();
    }
  });

  it("remove_domain_branding forwards scope when allowed", async () => {
    await h.handlers.get("remove_domain_branding")!({ domain_id: 7, scope: "all" });
    expect(h.client.removeDomainBranding).toHaveBeenCalledWith(7, "all");
  });
});
