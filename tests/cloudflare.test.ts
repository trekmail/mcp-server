import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TrekMailClient, type ClientConfig } from "../src/client.js";
import { createMockFetch, getLastFetchCall } from "./helpers/mock-fetch.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCloudflareTools } from "../src/tools/cloudflare.js";
import type { Config } from "../src/config.js";

describe("TrekMailClient — Cloudflare DNS apply/preview", () => {
  let client: TrekMailClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  const originalFetch = globalThis.fetch;

  const config: ClientConfig = {
    baseUrl: "https://trekmail.test",
    token: "tm_live_testtoken",
    timeoutMs: 30_000,
    userAgent: "trekmail-mcp/1.0.0",
  };

  beforeEach(() => {
    mockFetch = createMockFetch({ status: 200, body: { domains: {} } });
    globalThis.fetch = mockFetch;
    client = new TrekMailClient(config);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("forwards included_records on apply when provided", async () => {
    await client.applyCloudflareDns(
      [1, 2],
      { "1": ["dmarc"] },
      "idem-key",
      { "1": ["mx_primary"], "2": ["mx_primary", "spf_record"] },
    );
    const { url, init } = getLastFetchCall(mockFetch);
    expect(url).toContain("cloudflare/apply");
    const body = JSON.parse(init.body as string);
    expect(body.domain_ids).toEqual([1, 2]);
    expect(body.confirmed_conflicts).toEqual({ "1": ["dmarc"] });
    expect(body.included_records).toEqual({
      "1": ["mx_primary"],
      "2": ["mx_primary", "spf_record"],
    });
  });

  it("omits included_records on apply when not provided", async () => {
    await client.applyCloudflareDns([1]);
    const { init } = getLastFetchCall(mockFetch);
    const body = JSON.parse(init.body as string);
    expect(body.domain_ids).toEqual([1]);
    expect(body).not.toHaveProperty("included_records");
  });

  it("forwards included_records on preview when provided", async () => {
    await client.previewCloudflareDns([3], { "3": ["spf_record"] });
    const { url, init } = getLastFetchCall(mockFetch);
    expect(url).toContain("cloudflare/preview");
    const body = JSON.parse(init.body as string);
    expect(body.domain_ids).toEqual([3]);
    expect(body.included_records).toEqual({ "3": ["spf_record"] });
  });

  it("omits included_records on preview when not provided", async () => {
    await client.previewCloudflareDns([3]);
    const { init } = getLastFetchCall(mockFetch);
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("included_records");
  });

  it("reads Domain Connect eligibility without sending an API token or mutation", async () => {
    await client.getDomainConnectSetup(2275);
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/domains/2275/domain-connect/setup");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });
});

describe("one-time Domain Connect MCP handoff", () => {
  it("uses a read-only tool and returns the API result without starting consent", async () => {
    const server = new McpServer({ name: "test", version: "1" });
    const getDomainConnectSetup = vi.fn().mockResolvedValue({
      domain_setup: { domain_connect_available: false, blockers: ["dns_not_on_cloudflare"], domain_connect_url: null },
    });
    const client = { getDomainConnectSetup } as unknown as TrekMailClient;
    const config = { allowDestructive: false } as Config;
    let handler: ((args: { domain_id: number }) => Promise<unknown>) | undefined;
    const original = server.registerTool.bind(server);
    server.registerTool = ((name: string, definition: unknown, callback: never) => {
      if (name === "get_domain_connect_setup") handler = callback;
      return original(name, definition as Parameters<typeof original>[1], callback);
    }) as typeof server.registerTool;
    registerCloudflareTools(server, client, config);

    const tool = (server as unknown as {
      _registeredTools: Record<string, { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>;
    })._registeredTools.get_domain_connect_setup;
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).toBeFalsy();
    const result = await handler!({ domain_id: 7 });
    expect(getDomainConnectSetup).toHaveBeenCalledExactlyOnceWith(7);
    expect(result).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("dns_not_on_cloudflare") }],
    });
  });
});
