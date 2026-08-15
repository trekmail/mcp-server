import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TrekMailClient, type ClientConfig } from "../../src/client.js";
import { createMockFetch, getLastFetchCall } from "../helpers/mock-fetch.js";

/**
 * Wire-level coverage for the scheduled-send client methods. The MCP
 * tool wrappers (schedule_message / reschedule_message / cancel_scheduled)
 * marshal arguments into these calls — we test the wire shape here so a
 * tool-side regression (forgetting to forward `timezone`, or using POST
 * where PATCH is required) surfaces in CI rather than at the customer.
 *
 * Added 2026-05-24 alongside the acc #495 ticket #148 follow-ups:
 *   - schedule_message now accepts an optional IANA timezone
 *   - new reschedule_message tool (PATCH /messages/scheduled/{id})
 */
describe("scheduled-message client", () => {
  const msgToken = "tm_msg_scheduled_test_token";

  const clientConfig: ClientConfig = {
    baseUrl: "https://trekmail.test",
    token: msgToken,
    timeoutMs: 30_000,
    userAgent: "trekmail-mcp/1.0.0",
  };

  let client: TrekMailClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch({ status: 200, body: { id: 1 } });
    globalThis.fetch = mockFetch;
    client = new TrekMailClient(clientConfig);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("scheduleMessage POSTs to /messages/scheduled with the supplied body", async () => {
    await client.scheduleMessage(
      {
        to: ["a@example.com"],
        subject: "Hi",
        scheduled_for: "2026-12-01T10:00:00-05:00",
        timezone: "America/New_York",
        external_account_id: 11,
        identity_id: 22,
      },
      "idem-123",
    );

    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/scheduled");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.scheduled_for).toBe("2026-12-01T10:00:00-05:00");
    expect(body.timezone).toBe("America/New_York");
    expect(body.external_account_id).toBe(11);
    expect(body.identity_id).toBe(22);

    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idem-123");
  });

  it("scheduleMessage omits timezone when not provided", async () => {
    await client.scheduleMessage(
      { to: ["b@example.com"], scheduled_for: "2026-12-01T10:00:00Z" },
      "idem-456",
    );

    const { init } = getLastFetchCall(mockFetch);
    const body = JSON.parse(init.body as string);
    expect(body.timezone).toBeUndefined();
  });

  it("rescheduleMessage PATCHes /messages/scheduled/{id}", async () => {
    await client.rescheduleMessage(42, {
      scheduled_for: "2026-12-01T15:30:00",
      timezone: "America/Edmonton",
    });

    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/scheduled/42");
    expect(init.method).toBe("PATCH");

    const body = JSON.parse(init.body as string);
    expect(body.scheduled_for).toBe("2026-12-01T15:30:00");
    expect(body.timezone).toBe("America/Edmonton");
  });

  it("rescheduleMessage works without timezone", async () => {
    await client.rescheduleMessage(99, {
      scheduled_for: "2026-12-01T15:30:00Z",
    });

    const { init } = getLastFetchCall(mockFetch);
    const body = JSON.parse(init.body as string);
    expect(body.scheduled_for).toBe("2026-12-01T15:30:00Z");
    expect(body.timezone).toBeUndefined();
  });

  it("cancelScheduled DELETEs /messages/scheduled/{id} (regression guard)", async () => {
    await client.cancelScheduled(7);
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/scheduled/7");
    expect(init.method).toBe("DELETE");
  });

  it("listScheduled forwards cursor pagination to /messages/scheduled", async () => {
    await client.listScheduled({ cursor: "next-page", per_page: 25 });
    const { url, init } = getLastFetchCall(mockFetch);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/v1/messages/scheduled");
    expect(parsed.searchParams.get("cursor")).toBe("next-page");
    expect(parsed.searchParams.get("per_page")).toBe("25");
    expect(init.method).toBe("GET");
  });
});
