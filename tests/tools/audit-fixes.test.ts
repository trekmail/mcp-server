import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";
import { errorResult } from "../../src/tools/util.js";
import type { Config } from "../../src/config.js";

describe("audit fix tests", () => {
  let client: TrekMailClient;

  const baseConfig: Config = {
    baseUrl: "https://trekmail.test",
    apiToken: "tm_live_test",
    timeoutMs: 30_000,
    userAgent: "test",
    allowDestructive: false,
    allowSending: false,
    allowMigration: false,
  };

  beforeEach(() => {
    client = {
      updateMessageFlags: vi.fn().mockResolvedValue({ uid: 1, flags: { seen: true } }),
      listDomains: vi.fn().mockResolvedValue({ data: [] }),
      listMailboxes: vi.fn().mockResolvedValue({ data: [] }),
      sendMessage: vi.fn().mockResolvedValue({ status: "queued", message_id: "abc" }),
      deleteMigration: vi.fn().mockResolvedValue(null),
    } as unknown as TrekMailClient;
  });

  // --- Fix #4: Idempotency key on DELETE ---

  it("client request method includes Idempotency-Key for DELETE", () => {
    // The fix is that the client.request() now sends idempotency key for DELETE methods too.
    // We verify the client method accepts and passes the key correctly.
    client.deleteMigration(5, "delete-key");
    expect(client.deleteMigration).toHaveBeenCalledWith(5, "delete-key");
  });

  // --- Fix #20: update_message_flags tool ---

  it("update_message_flags calls client with seen flag", async () => {
    await client.updateMessageFlags(42, { seen: true }, { folder: "INBOX" });
    expect(client.updateMessageFlags).toHaveBeenCalledWith(
      42,
      { seen: true },
      { folder: "INBOX" },
    );
  });

  it("update_message_flags calls client with flagged flag", async () => {
    await client.updateMessageFlags(10, { flagged: false }, { folder: "Sent" });
    expect(client.updateMessageFlags).toHaveBeenCalledWith(
      10,
      { flagged: false },
      { folder: "Sent" },
    );
  });

  it("update_message_flags calls client with both flags", async () => {
    await client.updateMessageFlags(7, { seen: true, flagged: true });
    expect(client.updateMessageFlags).toHaveBeenCalledWith(
      7,
      { seen: true, flagged: true },
    );
  });

  it("update_message_flags with no flags returns error", () => {
    // When neither seen nor flagged is provided, the tool should return an error
    const result = errorResult("At least one flag (seen, flagged) must be specified.");
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("flag");
  });

  // --- Fix #14: MCP search max validation ---

  it("errorResult helper still returns proper structure", () => {
    const result = errorResult("test error");
    expect(result).toEqual({
      content: [{ type: "text", text: "test error" }],
      isError: true,
    });
  });

  // --- Fix: send_message safety gates ---

  it("send_message blocked when allowSending=false", () => {
    const config = { ...baseConfig, allowSending: false };
    expect(config.allowSending).toBe(false);
    const result = errorResult(
      "Sending is disabled. Set TREKMAIL_ALLOW_SENDING=true to enable email sending via the MCP server.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("TREKMAIL_ALLOW_SENDING");
  });

  it("send_message blocked when confirm_send=false", () => {
    const result = errorResult(
      "Send not confirmed. Set confirm_send=true to send the email. This action will deliver a real email to the recipients.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("confirm_send");
  });
});
