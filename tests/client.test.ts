import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TrekMailClient, type ClientConfig } from "../src/client.js";
import { TrekMailApiError } from "../src/errors.js";
import { createMockFetch, mockFetchResponse, getLastFetchCall, getLastFetchHeaders } from "./helpers/mock-fetch.js";

describe("TrekMailClient", () => {
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
    mockFetch = createMockFetch({ status: 200, body: { data: "ok" } });
    globalThis.fetch = mockFetch;
    client = new TrekMailClient(config);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends correct Authorization header", async () => {
    await client.listDomains();
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe("Bearer tm_live_testtoken");
  });

  it("sends X-Request-Id header in UUID format", async () => {
    await client.listDomains();
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["X-Request-Id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("sends User-Agent from config", async () => {
    await client.listDomains();
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["User-Agent"]).toBe("trekmail-mcp/1.0.0");
  });

  it("sends Idempotency-Key on POST requests", async () => {
    await client.dnsRecheck(1, "my-idem-key");
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["Idempotency-Key"]).toBe("my-idem-key");
  });

  it("sends Idempotency-Key on PUT requests", async () => {
    await client.setForwarding(1, { enabled: true, targets: ["a@b.com"], keep_copy: false }, "put-key");
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["Idempotency-Key"]).toBe("put-key");
  });

  it("sends Idempotency-Key on PATCH requests when provided", async () => {
    await (client as unknown as {
      request: (
        method: string,
        path: string,
        opts: { body: Record<string, unknown>; idempotencyKey: string },
      ) => Promise<unknown>;
    }).request("PATCH", "test-patch", { body: { enabled: true }, idempotencyKey: "patch-key" });
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["Idempotency-Key"]).toBe("patch-key");
  });

  it("sends generated Idempotency-Key on DELETE helper methods", async () => {
    await client.deleteMessage(42, { folder: "INBOX" });
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["Idempotency-Key"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("builds correct URL for list endpoints with query params", async () => {
    await client.listDomains({ status: "active", page: 2, per_page: 10 });
    const { url } = getLastFetchCall(mockFetch);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/v1/domains");
    expect(parsed.searchParams.get("status")).toBe("active");
    expect(parsed.searchParams.get("page")).toBe("2");
    expect(parsed.searchParams.get("per_page")).toBe("10");
  });

  it("builds correct URL for domain show", async () => {
    await client.getDomain(42);
    const { url } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/domains/42");
  });

  it("builds correct URL for delete-intent confirm", async () => {
    await client.confirmDeleteIntent(7, "idem-key");
    const { url } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/delete-intents/7:confirm");
  });

  it("sends X-Confirm-Delete header on confirmDeleteIntent", async () => {
    await client.confirmDeleteIntent(7, "idem-key");
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["X-Confirm-Delete"]).toBe("true");
  });

  it("parses successful JSON response", async () => {
    mockFetchResponse(mockFetch, { status: 200, body: { id: 1, name: "test" } });
    const result = await client.getDomain(1);
    expect(result).toEqual({ id: 1, name: "test" });
  });

  it("throws TrekMailApiError for 4xx/5xx responses", async () => {
    mockFetchResponse(mockFetch, {
      status: 422,
      body: {
        error: {
          code: "validation_error",
          message: "Invalid data",
          request_id: "req-123",
        },
      },
    });

    await expect(client.getDomain(999)).rejects.toThrow(TrekMailApiError);

    try {
      await client.getDomain(999);
    } catch (e) {
      // This won't actually run because the first assertion catches it,
      // but the above expect is sufficient
    }
  });

  it("surfaces a short hint for non-JSON API errors", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("<html><body>Bad gateway from proxy</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(client.getDomain(999)).rejects.toMatchObject({
      code: "non_json_response",
      statusCode: 502,
      hint: expect.stringContaining("Bad gateway from proxy"),
    });
  });

  it("includes password_mode in createMailboxGeneratedPassword body", async () => {
    await client.createMailboxGeneratedPassword(
      { domain_id: 1, local_part: "alice" },
      "idem-key",
    );
    const { init } = getLastFetchCall(mockFetch);
    const body = JSON.parse(init.body as string);
    expect(body.password_mode).toBe("generated_one_time");
    expect(body.domain_id).toBe(1);
    expect(body.local_part).toBe("alice");
  });
});
