import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import { registerDomainTools } from "../../src/tools/domains.js";
import type { Config } from "../../src/config.js";

describe("domain tools", () => {
  let server: McpServer;
  let client: TrekMailClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.0" });
    client = {
      listDomains: vi.fn().mockResolvedValue({ data: [{ id: 1 }] }),
      getDomain: vi.fn().mockResolvedValue({ id: 1, name: "example.com" }),
      getDomainSignature: vi.fn().mockResolvedValue({
        data: { mode: "off", position: "before_reply", html: null },
      }),
      updateDomainSignature: vi.fn().mockResolvedValue({
        data: { mode: "default", position: "before_reply", html: "<p>x</p>" },
      }),
    } as unknown as TrekMailClient;

    registerDomainTools(server, client);
  });

  it("list_domains passes params to client", async () => {
    const tool = server.tool.bind(server);
    // Access registered tools through the server's internal handler
    const result = await (client.listDomains as ReturnType<typeof vi.fn>)({ status: "active", page: 2 });
    expect(result).toEqual({ data: [{ id: 1 }] });
    expect(client.listDomains).toHaveBeenCalledWith({ status: "active", page: 2 });
  });

  it("get_domain passes domain_id to client", async () => {
    await (client.getDomain as ReturnType<typeof vi.fn>)(42);
    expect(client.getDomain).toHaveBeenCalledWith(42);
  });

  // --- Signature client method tests ---

  it("getDomainSignature calls GET endpoint with id", async () => {
    await (client.getDomainSignature as ReturnType<typeof vi.fn>)(42);
    expect(client.getDomainSignature).toHaveBeenCalledWith(42);
  });

  it("updateDomainSignature passes body to client", async () => {
    await (client.updateDomainSignature as ReturnType<typeof vi.fn>)(42, {
      signature_mode: "enforced",
      signature_position: "after_reply",
      signature_html: "<p>x</p>",
    });
    expect(client.updateDomainSignature).toHaveBeenCalledWith(42, expect.objectContaining({
      signature_mode: "enforced",
      signature_position: "after_reply",
      signature_html: "<p>x</p>",
    }));
  });

  // --- Destructive gating ---

  it("update_domain_signature is registered with destructiveHint", () => {
    const tools = (server as unknown as { _registeredTools: Record<string, { annotations?: { destructiveHint?: boolean } }> })._registeredTools;
    expect(tools.update_domain_signature).toBeDefined();
    expect(tools.update_domain_signature.annotations?.destructiveHint).toBe(true);
  });

  it("get_domain_signature has no destructive hint", () => {
    const tools = (server as unknown as { _registeredTools: Record<string, { annotations?: { destructiveHint?: boolean } }> })._registeredTools;
    expect(tools.get_domain_signature).toBeDefined();
    expect(tools.get_domain_signature.annotations?.destructiveHint).toBeFalsy();
  });

  it("update_domain_signature blocks when allowDestructive=false", async () => {
    const gatedServer = new McpServer({ name: "test", version: "0.0.0" });
    const gatedClient = {
      updateDomainSignature: vi.fn().mockResolvedValue({ data: {} }),
    } as unknown as TrekMailClient;
    const config: Config = {
      baseUrl: "x",
      apiToken: "x",
      timeoutMs: 30_000,
      userAgent: "test",
      allowDestructive: false,
      allowSending: false,
      allowMigration: false,
    };

    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>>();
    const orig = gatedServer.registerTool.bind(gatedServer);
    gatedServer.registerTool = ((name: string, def: unknown, h: never) => {
      handlers.set(name, h);
      return orig(name, def as Parameters<typeof orig>[1], h);
    }) as typeof gatedServer.registerTool;

    registerDomainTools(gatedServer, gatedClient, config);

    const handler = handlers.get("update_domain_signature")!;
    const result = await handler({
      domain_id: 1,
      signature_mode: "default",
      signature_html: "<p>x</p>",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/destructive/i);
    expect(gatedClient.updateDomainSignature).not.toHaveBeenCalled();
  });

  it("update_domain_signature succeeds when allowDestructive=true", async () => {
    const okServer = new McpServer({ name: "test", version: "0.0.0" });
    const okClient = {
      updateDomainSignature: vi.fn().mockResolvedValue({ data: { mode: "default" } }),
    } as unknown as TrekMailClient;
    const config: Config = {
      baseUrl: "x",
      apiToken: "x",
      timeoutMs: 30_000,
      userAgent: "test",
      allowDestructive: true,
      allowSending: false,
      allowMigration: false,
    };

    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<unknown>>();
    const orig = okServer.registerTool.bind(okServer);
    okServer.registerTool = ((name: string, def: unknown, h: never) => {
      handlers.set(name, h);
      return orig(name, def as Parameters<typeof orig>[1], h);
    }) as typeof okServer.registerTool;

    registerDomainTools(okServer, okClient, config);

    const handler = handlers.get("update_domain_signature")!;
    await handler({
      domain_id: 7,
      signature_mode: "enforced",
      signature_position: "after_reply",
      signature_html: "<p>Sales</p>",
    });
    expect(okClient.updateDomainSignature).toHaveBeenCalledWith(7, expect.objectContaining({
      signature_mode: "enforced",
      signature_position: "after_reply",
      signature_html: "<p>Sales</p>",
    }));
  });
});
