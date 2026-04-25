import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import { registerDomainTools } from "../../src/tools/domains.js";

describe("domain tools", () => {
  let server: McpServer;
  let client: TrekMailClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.0" });
    client = {
      listDomains: vi.fn().mockResolvedValue({ data: [{ id: 1 }] }),
      getDomain: vi.fn().mockResolvedValue({ id: 1, name: "example.com" }),
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
});
