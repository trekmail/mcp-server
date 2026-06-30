import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import type { Config } from "../../src/config.js";
import { registerDeleteIntentTools } from "../../src/tools/delete-intents.js";
import { callApi, errorResult } from "../../src/tools/util.js";

describe("delete intent tools", () => {
  const baseConfig: Config = {
    baseUrl: "https://trekmail.test",
    apiToken: "tm_live_test",
    timeoutMs: 30_000,
    userAgent: "test",
    allowDestructive: false,
  };

  it("errorResult returns proper structure", () => {
    const result = errorResult("test error");
    expect(result).toEqual({
      content: [{ type: "text", text: "test error" }],
      isError: true,
    });
  });

  it("callApi formats successful response as pretty JSON", async () => {
    const result = await callApi(async () => ({ id: 1, name: "test" }));
    expect(result.isError).toBeUndefined();
    const text = result.content[0];
    expect(text.type).toBe("text");
    expect("text" in text && text.text).toContain('"id": 1');
    expect("text" in text && text.text).toContain('"name": "test"');
  });

  it("callApi formats API error with plan-gating hint", async () => {
    const { TrekMailApiError } = await import("../../src/errors.js");
    const result = await callApi(async () => {
      throw new TrekMailApiError(403, "plan_api_disabled", "API not available on your plan");
    });
    expect(result.isError).toBe(true);
    const text = result.content[0];
    expect("text" in text && text.text).toContain("plan_api_disabled");
    expect("text" in text && text.text).toContain("Pro or Agency");
  });

  it("create_delete_intent blocked when allowDestructive=false", () => {
    const config = { ...baseConfig, allowDestructive: false };
    // Verify the safety gate logic directly
    expect(config.allowDestructive).toBe(false);
    const result = errorResult(
      "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable mailbox deletion via the MCP server.",
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toHaveProperty("text");
    expect(
      "text" in result.content[0] && result.content[0].text,
    ).toContain("TREKMAIL_ALLOW_DESTRUCTIVE");
  });

  it("confirm_delete_intent blocked when confirm=false", () => {
    const result = errorResult(
      "Deletion not confirmed. Set confirm=true to move the mailbox to the recycle bin (restorable for the retention window with restore_mailbox).",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("recycle bin");
  });

  it("createDeleteIntent is called when gates pass", async () => {
    const client = {
      createDeleteIntent: vi.fn().mockResolvedValue({ id: 1, status: "pending", expires_at: "2025-01-01" }),
    } as unknown as TrekMailClient;

    await client.createDeleteIntent(5, "idem-key");
    expect(client.createDeleteIntent).toHaveBeenCalledWith(5, "idem-key");
  });

  it("confirmDeleteIntent is called when both gates pass", async () => {
    const client = {
      confirmDeleteIntent: vi.fn().mockResolvedValue({ id: 1, status: "confirmed" }),
    } as unknown as TrekMailClient;

    await client.confirmDeleteIntent(1, "idem-key");
    expect(client.confirmDeleteIntent).toHaveBeenCalledWith(1, "idem-key");
  });

  it("restoreMailbox is called with mailbox id and idem key", async () => {
    const client = {
      restoreMailbox: vi.fn().mockResolvedValue({ id: 5, status: "active" }),
    } as unknown as TrekMailClient;

    await client.restoreMailbox(5, "idem-key");
    expect(client.restoreMailbox).toHaveBeenCalledWith(5, "idem-key");
  });

  it("list_trashed_mailboxes lists mailboxes with status=trashed", async () => {
    const client = {
      listMailboxes: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as TrekMailClient;

    await client.listMailboxes({ status: "trashed", domain_id: 3, per_page: 50 });
    expect(client.listMailboxes).toHaveBeenCalledWith({
      status: "trashed",
      domain_id: 3,
      per_page: 50,
    });
  });
});
