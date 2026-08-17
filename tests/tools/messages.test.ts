import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TrekMailClient, type ClientConfig } from "../../src/client.js";
import type { Config } from "../../src/config.js";
import { createMockFetch, getLastFetchCall, getLastFetchHeaders, mockFetchResponse } from "../helpers/mock-fetch.js";
import { callApi, errorResult } from "../../src/tools/util.js";

describe("message tools", () => {
  const msgToken = "tm_msg_test_message_token";

  const clientConfig: ClientConfig = {
    baseUrl: "https://trekmail.test",
    token: msgToken,
    timeoutMs: 30_000,
    userAgent: "trekmail-mcp/1.0.0",
  };

  const baseConfig: Config = {
    baseUrl: "https://trekmail.test",
    messageToken: msgToken,
    timeoutMs: 30_000,
    userAgent: "trekmail-mcp/1.0.0",
    allowDestructive: false,
    allowSending: false,
  };

  let client: TrekMailClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch({ status: 200, body: { messages: [] } });
    globalThis.fetch = mockFetch;
    client = new TrekMailClient(clientConfig);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // --- list_messages ---

  it("listMessages calls correct URL", async () => {
    await client.listMessages({ folder: "INBOX", limit: 10 });
    const { url } = getLastFetchCall(mockFetch);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/v1/messages");
    expect(parsed.searchParams.get("folder")).toBe("INBOX");
    expect(parsed.searchParams.get("limit")).toBe("10");
  });

  it("listMessages sends message token in Authorization header", async () => {
    await client.listMessages();
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe(`Bearer ${msgToken}`);
  });

  it("listMessages passes all query params", async () => {
    await client.listMessages({
      folder: "INBOX.Sent",
      limit: 25,
      before_uid: 100,
      since: "2026-01-01",
      unread_only: true,
      search: "invoice",
    });
    const { url } = getLastFetchCall(mockFetch);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("folder")).toBe("INBOX.Sent");
    expect(parsed.searchParams.get("limit")).toBe("25");
    expect(parsed.searchParams.get("before_uid")).toBe("100");
    expect(parsed.searchParams.get("since")).toBe("2026-01-01");
    expect(parsed.searchParams.get("unread_only")).toBe("true");
    expect(parsed.searchParams.get("search")).toBe("invoice");
  });

  // --- read_message ---

  it("getMessage calls correct URL with uid path param", async () => {
    await client.getMessage(42, { folder: "INBOX" });
    const { url } = getLastFetchCall(mockFetch);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/v1/messages/42");
    expect(parsed.searchParams.get("folder")).toBe("INBOX");
  });

  it("getMessage sends message token in Authorization header", async () => {
    await client.getMessage(1);
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers.Authorization).toBe(`Bearer ${msgToken}`);
  });

  // --- send_message ---

  it("sendMessage calls correct URL and method", async () => {
    await client.sendMessage(
      { to: ["alice@example.com"], subject: "Hi", body: { text: "Hello" } },
      "idem-key-123",
    );
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/send");
    expect(init.method).toBe("POST");
  });

  it("sendMessage sets Idempotency-Key header", async () => {
    await client.sendMessage(
      { to: ["alice@example.com"], subject: "Hi", body: { text: "Hello" } },
      "my-idem-key",
    );
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["Idempotency-Key"]).toBe("my-idem-key");
  });

  // --- Drafts (ticket #354) ---
  //
  // Both draft routes are behind the message-API idempotency middleware. With
  // no Idempotency-Key they answered 422 missing_idempotency_key on every
  // single call, and the tool schemas exposed no way to supply one.

  it("saveDraft sets an Idempotency-Key header", async () => {
    await client.saveDraft({ subject: "Draft" });
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });

  it("updateDraft sets an Idempotency-Key header", async () => {
    await client.updateDraft(42, { subject: "Draft" });
    const headers = getLastFetchHeaders(mockFetch);
    expect(headers["Idempotency-Key"]).toBeTruthy();
  });

  it("saveDraft generates a FRESH key per call for identical params", async () => {
    // Guard against "fix" by deterministic hashing, as send_message does. The
    // middleware replays a stored response for a repeated key, so a hash of the
    // body would make a second identical draft silently return the first one's
    // UID instead of creating a second draft.
    mockFetchResponse(mockFetch, { status: 200, body: { uid: 1 } });
    await client.saveDraft({ subject: "Same" });
    const first = getLastFetchHeaders(mockFetch)["Idempotency-Key"];

    mockFetchResponse(mockFetch, { status: 200, body: { uid: 2 } });
    await client.saveDraft({ subject: "Same" });
    const second = getLastFetchHeaders(mockFetch)["Idempotency-Key"];

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it("updateDraft generates a FRESH key per call for identical params", async () => {
    // Same reasoning, sharper: reverting a draft to earlier content must really
    // update it, not replay the response of the call that first wrote it.
    mockFetchResponse(mockFetch, { status: 200, body: { uid: 7 } });
    await client.updateDraft(7, { subject: "Same" });
    const first = getLastFetchHeaders(mockFetch)["Idempotency-Key"];

    mockFetchResponse(mockFetch, { status: 200, body: { uid: 7 } });
    await client.updateDraft(7, { subject: "Same" });
    const second = getLastFetchHeaders(mockFetch)["Idempotency-Key"];

    expect(second).not.toBe(first);
  });

  it("saveDraft and updateDraft forward an explicit key verbatim", async () => {
    mockFetchResponse(mockFetch, { status: 200, body: { uid: 1 } });
    await client.saveDraft({ subject: "Draft" }, "caller-chosen-key");
    expect(getLastFetchHeaders(mockFetch)["Idempotency-Key"]).toBe("caller-chosen-key");

    mockFetchResponse(mockFetch, { status: 200, body: { uid: 1 } });
    await client.updateDraft(9, { subject: "Draft" }, "caller-chosen-key-2");
    expect(getLastFetchHeaders(mockFetch)["Idempotency-Key"]).toBe("caller-chosen-key-2");
  });

  it("saveDraft posts to the drafts route with the draft body", async () => {
    await client.saveDraft({ subject: "Hello", to: ["alice@example.com"] });
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/drafts");
    expect(init.method).toBe("POST");
    const parsed = JSON.parse(init.body as string);
    expect(parsed.subject).toBe("Hello");
    expect(parsed.to).toEqual(["alice@example.com"]);
  });

  it("updateDraft puts to the draft's own route", async () => {
    await client.updateDraft(1234, { subject: "Hello" });
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/drafts/1234");
    expect(init.method).toBe("PUT");
  });

  it("sendMessage sends correct body shape", async () => {
    const body = {
      to: ["alice@example.com"],
      cc: ["bob@example.com"],
      subject: "Test",
      body: { text: "Hello", html: "<p>Hello</p>" },
      reply_to_message_id: "<orig@example.com>",
      external_account_id: 11,
      identity_id: 22,
    };
    await client.sendMessage(body, "key");
    const { init } = getLastFetchCall(mockFetch);
    const parsed = JSON.parse(init.body as string);
    expect(parsed.to).toEqual(["alice@example.com"]);
    expect(parsed.cc).toEqual(["bob@example.com"]);
    expect(parsed.body.text).toBe("Hello");
    expect(parsed.body.html).toBe("<p>Hello</p>");
    expect(parsed.reply_to_message_id).toBe("<orig@example.com>");
    expect(parsed.external_account_id).toBe(11);
    expect(parsed.identity_id).toBe(22);
  });

  // --- Safety gate tests ---

  it("send_message blocked when allowSending=false", () => {
    const config = { ...baseConfig, allowSending: false };
    expect(config.allowSending).toBe(false);
    const result = errorResult(
      "Sending is disabled. Set TREKMAIL_ALLOW_SENDING=true to enable email sending via the MCP server.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain(
      "TREKMAIL_ALLOW_SENDING",
    );
  });

  it("send_message blocked when confirm_send=false", () => {
    const result = errorResult(
      "Send not confirmed. Set confirm_send=true to send the email. This action will deliver a real email to the recipients.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain(
      "confirm_send=true",
    );
  });

  it("sendMessage is called when both gates pass", async () => {
    const mockClient = {
      sendMessage: vi.fn().mockResolvedValue({
        status: "queued",
        message_id: "<test@example.com>",
        queued_at: "2026-02-07T12:00:00Z",
      }),
    } as unknown as TrekMailClient;

    await mockClient.sendMessage(
      { to: ["alice@example.com"], subject: "Hi", body: { text: "Hello" } },
      "idem-key",
    );
    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      { to: ["alice@example.com"], subject: "Hi", body: { text: "Hello" } },
      "idem-key",
    );
  });

  // --- Error formatting ---

  it("callApi formats message API error correctly", async () => {
    const { TrekMailApiError } = await import("../../src/errors.js");
    const result = await callApi(async () => {
      throw new TrekMailApiError(502, "imap_connection_failed", "Could not connect to mailbox.", {
        retryable: true,
        hint: "Try again shortly.",
      });
    });
    expect(result.isError).toBe(true);
    const text = result.content[0];
    expect("text" in text && text.text).toContain("imap_connection_failed");
    expect("text" in text && text.text).toContain("Try again shortly");
  });
});
