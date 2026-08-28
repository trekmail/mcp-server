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
      getDomainAlias: vi.fn().mockResolvedValue({ configured: false }),
      setDomainAlias: vi.fn().mockResolvedValue({ configured: true }),
      removeDomainAlias: vi.fn().mockResolvedValue({ configured: false }),
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

  it("registers matching-address tools with the right safety hints", () => {
    const tools = (server as unknown as {
      _registeredTools: Record<string, { annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }>;
    })._registeredTools;

    expect(tools.get_domain_alias.annotations?.readOnlyHint).toBe(true);
    expect(tools.get_domain_alias.annotations?.destructiveHint).toBeFalsy();
    expect(tools.set_domain_alias.annotations?.destructiveHint).toBe(true);
    expect(tools.remove_domain_alias.annotations?.destructiveHint).toBe(true);
  });

  it("blocks matching-address mutations unless destructive changes are enabled", async () => {
    const gatedServer = new McpServer({ name: "test", version: "0.0.0" });
    const gatedClient = {
      setDomainAlias: vi.fn(),
      removeDomainAlias: vi.fn(),
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
    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<{ isError?: boolean }>>();
    const orig = gatedServer.registerTool.bind(gatedServer);
    gatedServer.registerTool = ((name: string, def: unknown, handler: never) => {
      handlers.set(name, handler);
      return orig(name, def as Parameters<typeof orig>[1], handler);
    }) as typeof gatedServer.registerTool;

    registerDomainTools(gatedServer, gatedClient, config);

    expect((await handlers.get("set_domain_alias")!({
      domain_id: 1,
      primary_domain_id: 2,
    })).isError).toBe(true);
    expect((await handlers.get("remove_domain_alias")!({
      domain_id: 1,
      confirm_remove: true,
    })).isError).toBe(true);
    expect(gatedClient.setDomainAlias).not.toHaveBeenCalled();
    expect(gatedClient.removeDomainAlias).not.toHaveBeenCalled();
  });

  it("connects and disconnects matching addresses when explicitly allowed", async () => {
    const okServer = new McpServer({ name: "test", version: "0.0.0" });
    const okClient = {
      setDomainAlias: vi.fn().mockResolvedValue({ configured: true }),
      removeDomainAlias: vi.fn().mockResolvedValue({ configured: false }),
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
    okServer.registerTool = ((name: string, def: unknown, handler: never) => {
      handlers.set(name, handler);
      return orig(name, def as Parameters<typeof orig>[1], handler);
    }) as typeof okServer.registerTool;

    registerDomainTools(okServer, okClient, config);
    await handlers.get("set_domain_alias")!({
      domain_id: 4,
      primary_domain_id: 9,
      idempotency_key: "connect-demo",
    });
    await handlers.get("remove_domain_alias")!({
      domain_id: 4,
      confirm_remove: true,
      idempotency_key: "disconnect-demo",
    });

    expect(okClient.setDomainAlias).toHaveBeenCalledWith(4, 9, "connect-demo");
    expect(okClient.removeDomainAlias).toHaveBeenCalledWith(4, "disconnect-demo");
  });

  it("requires explicit confirmation before disconnecting matching addresses", async () => {
    const okServer = new McpServer({ name: "test", version: "0.0.0" });
    const okClient = { removeDomainAlias: vi.fn() } as unknown as TrekMailClient;
    const config: Config = {
      baseUrl: "x",
      apiToken: "x",
      timeoutMs: 30_000,
      userAgent: "test",
      allowDestructive: true,
      allowSending: false,
      allowMigration: false,
    };
    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<{ isError?: boolean }>>();
    const orig = okServer.registerTool.bind(okServer);
    okServer.registerTool = ((name: string, def: unknown, handler: never) => {
      handlers.set(name, handler);
      return orig(name, def as Parameters<typeof orig>[1], handler);
    }) as typeof okServer.registerTool;

    registerDomainTools(okServer, okClient, config);
    const result = await handlers.get("remove_domain_alias")!({
      domain_id: 4,
      confirm_remove: false,
    });

    expect(result.isError).toBe(true);
    expect(okClient.removeDomainAlias).not.toHaveBeenCalled();
  });

  it("registers the full forwarding-address lifecycle with the Pro delivery gate", () => {
    const tools = (server as unknown as {
      _registeredTools: Record<string, { description?: string; annotations?: { destructiveHint?: boolean; readOnlyHint?: boolean } }>;
    })._registeredTools;

    expect(tools.list_forwarding_addresses.annotations?.readOnlyHint).toBe(true);
    expect(tools.get_forwarding_address_log.annotations?.readOnlyHint).toBe(true);
    expect(tools.create_forwarding_address.description).toMatch(/requires Pro or Agency/);
    expect(tools.update_forwarding_address).toBeDefined();
    expect(tools.delete_forwarding_address.annotations?.destructiveHint).toBe(true);
  });

  it("runs the forwarding-address lifecycle through the REST client", async () => {
    const lifecycleServer = new McpServer({ name: "test", version: "0.0.0" });
    const lifecycleClient = {
      listForwardingAddresses: vi.fn().mockResolvedValue({ data: [], limits: { max: 100 } }),
      getForwardingAddressLog: vi.fn().mockResolvedValue({ data: [], window: { retention_days: 7 } }),
      createForwardingAddress: vi.fn().mockResolvedValue({ data: { id: 8 } }),
      updateForwardingAddress: vi.fn().mockResolvedValue({ data: { id: 8, is_active: false } }),
      deleteForwardingAddress: vi.fn().mockResolvedValue({ deleted: true }),
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
    const orig = lifecycleServer.registerTool.bind(lifecycleServer);
    lifecycleServer.registerTool = ((name: string, def: unknown, handler: never) => {
      handlers.set(name, handler);
      return orig(name, def as Parameters<typeof orig>[1], handler);
    }) as typeof lifecycleServer.registerTool;

    registerDomainTools(lifecycleServer, lifecycleClient, config);
    await handlers.get("list_forwarding_addresses")!({ domain_id: 4 });
    await handlers.get("get_forwarding_address_log")!({ domain_id: 4, forwarding_address_id: 8, limit: 25 });
    await handlers.get("create_forwarding_address")!({
      domain_id: 4,
      local_part: "sales",
      recipients: ["team@example.net"],
      idempotency_key: "create-fwd",
    });
    await handlers.get("update_forwarding_address")!({ domain_id: 4, forwarding_address_id: 8, is_active: false });
    await handlers.get("delete_forwarding_address")!({
      domain_id: 4,
      forwarding_address_id: 8,
      idempotency_key: "delete-fwd",
    });

    expect(lifecycleClient.listForwardingAddresses).toHaveBeenCalledWith(4);
    expect(lifecycleClient.getForwardingAddressLog).toHaveBeenCalledWith(4, 8, 25);
    expect(lifecycleClient.createForwardingAddress).toHaveBeenCalledWith(4, "sales", ["team@example.net"], true, "create-fwd");
    expect(lifecycleClient.updateForwardingAddress).toHaveBeenCalledWith(4, 8, { is_active: false });
    expect(lifecycleClient.deleteForwardingAddress).toHaveBeenCalledWith(4, 8, "delete-fwd");
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
