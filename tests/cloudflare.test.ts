import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TrekMailClient, type ClientConfig } from "../src/client.js";
import { createMockFetch, getLastFetchCall } from "./helpers/mock-fetch.js";

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
});
