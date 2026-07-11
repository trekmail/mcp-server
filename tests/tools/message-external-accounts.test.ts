import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TrekMailClient, type ClientConfig } from "../../src/client.js";
import { createMockFetch, getLastFetchCall } from "../helpers/mock-fetch.js";

/**
 * Connected external-account MCP surface: the 7 management tools + the
 * external_account_id parameter forwarded by the message tools. These assert the
 * client builds the right request (path / method / query / body); ownership +
 * plan gating live server-side (covered by the PHP feature tests).
 */
describe("connected external accounts", () => {
  const msgToken = "tm_msg_test_message_token";
  const clientConfig: ClientConfig = {
    baseUrl: "https://trekmail.test",
    token: msgToken,
    timeoutMs: 30_000,
    userAgent: "trekmail-mcp/1.1.0",
  };

  let client: TrekMailClient;
  let mockFetch: ReturnType<typeof createMockFetch>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch({ status: 200, body: { data: [] } });
    globalThis.fetch = mockFetch;
    client = new TrekMailClient(clientConfig);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const parseBody = () => {
    const { init } = getLastFetchCall(mockFetch);
    return init.body ? JSON.parse(String(init.body)) : undefined;
  };

  // --- Management tools ---

  it("listExternalAccounts GETs the collection", async () => {
    await client.listExternalAccounts();
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/external-accounts");
    expect(init.method).toBe("GET");
  });

  it("detectExternalAccount POSTs the email", async () => {
    await client.detectExternalAccount("someone@outlook.com");
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/external-accounts/detect");
    expect(init.method).toBe("POST");
    expect(parseBody()).toEqual({ email: "someone@outlook.com" });
  });

  it("testExternalAccount POSTs unsaved credentials", async () => {
    await client.testExternalAccount({ email: "a@gmail.com", password: "p" });
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/external-accounts/test");
    expect(init.method).toBe("POST");
  });

  it("createExternalAccount POSTs to the collection", async () => {
    await client.createExternalAccount({ email: "a@gmail.com", password: "p" });
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/external-accounts");
    expect(init.method).toBe("POST");
  });

  it("updateExternalAccount PATCHes the account", async () => {
    await client.updateExternalAccount(7, { label: "Work" });
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/external-accounts/7");
    expect(init.method).toBe("PATCH");
    expect(parseBody()).toEqual({ label: "Work" });
  });

  it("testSavedExternalAccount POSTs to the account test route", async () => {
    await client.testSavedExternalAccount(7);
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/external-accounts/7/test");
    expect(init.method).toBe("POST");
  });

  it("deleteExternalAccount DELETEs the account", async () => {
    await client.deleteExternalAccount(7);
    const { url, init } = getLastFetchCall(mockFetch);
    expect(new URL(url).pathname).toBe("/api/v1/messages/external-accounts/7");
    expect(init.method).toBe("DELETE");
  });

  // --- external_account_id forwarding on message tools (one call per test:
  //     the mock reuses a single Response whose body can only be read once) ---

  const queryEa = () =>
    new URL(getLastFetchCall(mockFetch).url).searchParams.get("external_account_id");

  it("listMessages forwards external_account_id as a query param", async () => {
    await client.listMessages({ folder: "INBOX", external_account_id: 7 });
    expect(queryEa()).toBe("7");
  });

  it("getRawMessage forwards external_account_id as a query param", async () => {
    await client.getRawMessage(42, { folder: "INBOX", external_account_id: 7 });
    expect(queryEa()).toBe("7");
  });

  it("downloadAttachment forwards external_account_id as a query param", async () => {
    await client.downloadAttachment(42, 0, { external_account_id: 7 });
    expect(queryEa()).toBe("7");
  });

  it("downloadAllAttachments forwards external_account_id as a query param", async () => {
    await client.downloadAllAttachments(42, { external_account_id: 7 });
    expect(queryEa()).toBe("7");
  });

  it("sendMessage forwards external_account_id in the body", async () => {
    await client.sendMessage({ to: ["x@y.com"], subject: "s", body_text: "b", external_account_id: 7 }, "idem-1");
    expect(parseBody().external_account_id).toBe(7);
  });

  it("saveDraft forwards external_account_id in the body", async () => {
    await client.saveDraft({ subject: "s", external_account_id: 7 });
    expect(parseBody().external_account_id).toBe(7);
  });

  it("updateDraft forwards external_account_id in the body", async () => {
    await client.updateDraft(5, { subject: "s", external_account_id: 7 });
    expect(parseBody().external_account_id).toBe(7);
  });

  it("bulkAction forwards external_account_id in the body", async () => {
    await client.bulkAction({ folder: "INBOX", uids: [1, 2], action: "read", external_account_id: 7 });
    expect(parseBody().external_account_id).toBe(7);
  });
});
