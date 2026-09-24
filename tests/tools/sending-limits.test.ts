import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TrekMailClient, type ClientConfig } from "../../src/client.js";
import { TrekMailApiError } from "../../src/errors.js";
import { withRetry } from "../../src/retry.js";
import { createMockFetch, getLastFetchCall, mockFetchResponse } from "../helpers/mock-fetch.js";

/**
 * Sending limits reach the agent as facts it can act on: which allowance,
 * when it renews, and never a retry loop against a limit that cannot clear.
 */
describe("sending limits", () => {
  const clientConfig: ClientConfig = {
    baseUrl: "https://trekmail.test",
    token: "tm_msg_test_message_token",
    timeoutMs: 30_000,
    userAgent: "trekmail-mcp/1.0.0",
  };

  let client: TrekMailClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch({ status: 200, body: {} });
    globalThis.fetch = mockFetch;
    client = new TrekMailClient(clientConfig);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("getMessageDelivery looks the send up by its request id", async () => {
    await client.getMessageDelivery("req 1/2");
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/deliveries/req%201%2F2");
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("getMailboxSendingLimits and getSendingLimits call their endpoints", async () => {
    mockFetchResponse(mockFetch, { body: {} });
    await client.getMailboxSendingLimits();
    expect(new URL(getLastFetchCall(mockFetch).url).pathname).toBe("/api/v1/messages/sending-limits");

    mockFetchResponse(mockFetch, { body: {} });
    await client.getSendingLimits();
    expect(new URL(getLastFetchCall(mockFetch).url).pathname).toBe("/api/v1/sending-limits");
  });

  it("listScheduled passes the status filter for held messages", async () => {
    mockFetchResponse(mockFetch, { body: { scheduled: [] } });
    await client.listScheduled({ status: "limit_reached" });
    const parsed = new URL(getLastFetchCall(mockFetch).url);
    expect(parsed.pathname).toBe("/api/v1/messages/scheduled");
    expect(parsed.searchParams.get("status")).toBe("limit_reached");
  });

  it("a spent allowance tells the agent when to come back instead of to retry", () => {
    const error = TrekMailApiError.fromResponse(429, {
      error: {
        code: "sending_limit_exceeded",
        message: "Sending limit reached.",
        hint: "This mailbox has sent to 30 of its 30 recipients for today.",
        request_id: "req-1",
        retryable: false,
        dimension: "mailbox_daily",
        resets_at: "2026-09-25T00:00:00+00:00",
      },
    });

    const text = error.toMcpText();
    expect(text).toContain("API Error [sending_limit_exceeded]");
    expect(text).toContain("Action: Do not retry before 2026-09-25T00:00:00+00:00.");
  });

  it("too many recipients says to split the message", () => {
    const error = TrekMailApiError.fromResponse(429, {
      error: { code: "sending_limit_exceeded", message: "x", request_id: "r", retryable: false, dimension: "recipients_per_message" },
    });

    expect(error.toMcpText()).toContain("Split the message");
  });

  it("errors without a dimension get no sending advice", () => {
    const error = TrekMailApiError.fromResponse(429, {
      error: { code: "rate_limited", message: "Too many requests.", request_id: "r", retryable: true },
    });

    expect(error.toMcpText()).not.toContain("Action:");
  });

  it("a sending-limit 429 is not retried", async () => {
    const fn = vi.fn().mockRejectedValue(
      TrekMailApiError.fromResponse(429, {
        error: { code: "sending_limit_exceeded", message: "x", request_id: "r", retryable: false, dimension: "account_daily", resets_at: "2026-09-25T00:00:00+00:00" },
      }),
    );

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })).rejects.toBeInstanceOf(TrekMailApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
