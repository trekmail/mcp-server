import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TrekMailClient, makeClientConfig, type ClientConfig } from "../src/client.js";
import type { Config } from "../src/config.js";
import { createMockFetch, mockFetchResponse, getLastFetchHeaders } from "./helpers/mock-fetch.js";

describe("token routing", () => {
  const opsToken = "tm_live_ops_routing_test";
  const msgToken = "tm_msg_routing_test";

  const sharedConfig: Config = {
    baseUrl: "https://trekmail.test",
    apiToken: opsToken,
    messageToken: msgToken,
    timeoutMs: 30_000,
    userAgent: "trekmail-mcp/1.0.0",
    allowDestructive: false,
    allowSending: true,
  };

  let opsClient: TrekMailClient;
  let msgClient: TrekMailClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch({ status: 200, body: { data: [] } });
    globalThis.fetch = mockFetch;

    opsClient = new TrekMailClient(makeClientConfig(sharedConfig, sharedConfig.apiToken!));
    msgClient = new TrekMailClient(makeClientConfig(sharedConfig, sharedConfig.messageToken!));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- Infra endpoints use ops token ---

  it("listDomains uses ops token", async () => {
    await opsClient.listDomains();
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe(`Bearer ${opsToken}`);
  });

  it("getDomain uses ops token", async () => {
    await opsClient.getDomain(1);
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe(`Bearer ${opsToken}`);
  });

  it("createMailboxGeneratedPassword uses ops token", async () => {
    await opsClient.createMailboxGeneratedPassword(
      { domain_id: 1, local_part: "test" },
      "idem",
    );
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe(`Bearer ${opsToken}`);
  });

  // --- Message endpoints use message token ---

  it("listMessages uses message token", async () => {
    await msgClient.listMessages({ folder: "INBOX" });
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe(`Bearer ${msgToken}`);
  });

  it("getMessage uses message token", async () => {
    await msgClient.getMessage(42);
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe(`Bearer ${msgToken}`);
  });

  it("sendMessage uses message token", async () => {
    await msgClient.sendMessage(
      { to: ["a@b.com"], subject: "Test", body: { text: "Hello" } },
      "idem-key",
    );
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe(`Bearer ${msgToken}`);
  });

  // --- Cross-pollination prevention ---

  it("ops client never sends message token", async () => {
    await opsClient.listDomains();
    const headers1 = getLastFetchHeaders(mockFetch);
    expect(headers1.Authorization).not.toContain(msgToken);

    // Queue a fresh response for the second call (Response body is single-use)
    mockFetchResponse(mockFetch, { status: 200, body: { data: [] } });
    await opsClient.getDomain(1);
    const headers2 = getLastFetchHeaders(mockFetch);
    expect(headers2.Authorization).not.toContain(msgToken);
  });

  it("message client never sends ops token", async () => {
    await msgClient.listMessages();
    const headers1 = getLastFetchHeaders(mockFetch);
    expect(headers1.Authorization).not.toContain(opsToken);

    // Queue a fresh response for the second call
    mockFetchResponse(mockFetch, { status: 200, body: { data: [] } });
    await msgClient.getMessage(1);
    const headers2 = getLastFetchHeaders(mockFetch);
    expect(headers2.Authorization).not.toContain(opsToken);
  });

  // --- makeClientConfig factory ---

  it("makeClientConfig creates correct config from shared config + token", () => {
    const opsConfig = makeClientConfig(sharedConfig, opsToken);
    expect(opsConfig.token).toBe(opsToken);
    expect(opsConfig.baseUrl).toBe(sharedConfig.baseUrl);
    expect(opsConfig.timeoutMs).toBe(sharedConfig.timeoutMs);
    expect(opsConfig.userAgent).toBe(sharedConfig.userAgent);

    const msgConfig = makeClientConfig(sharedConfig, msgToken);
    expect(msgConfig.token).toBe(msgToken);
    expect(msgConfig.baseUrl).toBe(sharedConfig.baseUrl);
  });

  it("two clients from same config have independent tokens", () => {
    const opsConfig = makeClientConfig(sharedConfig, opsToken);
    const msgConfig = makeClientConfig(sharedConfig, msgToken);

    expect(opsConfig.token).not.toBe(msgConfig.token);
    expect(opsConfig.baseUrl).toBe(msgConfig.baseUrl);
  });
});
