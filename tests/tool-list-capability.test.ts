import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { ensureToolListCapability } from "../src/tool-list-capability.js";

describe("empty tool surface", () => {
  it("answers tools/list with an empty list instead of method-not-found", async () => {
    const server = new McpServer({ name: "empty", version: "1" });
    ensureToolListCapability(server);

    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      await expect(client.listTools()).resolves.toEqual({ tools: [] });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
