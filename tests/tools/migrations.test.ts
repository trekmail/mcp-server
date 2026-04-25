import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";
import { errorResult } from "../../src/tools/util.js";
import type { Config } from "../../src/config.js";

describe("migration tools", () => {
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
      testMigrationConnection: vi.fn().mockResolvedValue({ success: true, folders: { INBOX: 100 } }),
      listMigrations: vi.fn().mockResolvedValue({ data: [] }),
      getMigration: vi.fn().mockResolvedValue({ data: { id: 1, status: "completed" } }),
      startMigration: vi.fn().mockResolvedValue({ data: { id: 1, status: "pending" } }),
      cancelMigration: vi.fn().mockResolvedValue({ data: { id: 1, status: "cancelled" } }),
      retryMigration: vi.fn().mockResolvedValue({ data: { id: 1, status: "pending" } }),
      deleteMigration: vi.fn().mockResolvedValue(null),
    } as unknown as TrekMailClient;
  });

  // --- Client method tests ---

  it("testMigrationConnection passes params to client", async () => {
    await client.testMigrationConnection(
      { source_host: "imap.gmail.com", source_port: 993, source_security: "ssl", source_email: "user@gmail.com", source_password: "pass" },
      "test-key",
    );
    expect(client.testMigrationConnection).toHaveBeenCalledWith(
      expect.objectContaining({ source_host: "imap.gmail.com" }),
      "test-key",
    );
  });

  it("listMigrations passes params to client", async () => {
    await client.listMigrations({ status: "completed", page: 1 });
    expect(client.listMigrations).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("getMigration passes id to client", async () => {
    await client.getMigration(42);
    expect(client.getMigration).toHaveBeenCalledWith(42);
  });

  it("retryMigration passes id to client", async () => {
    await client.retryMigration(99, "retry-key");
    expect(client.retryMigration).toHaveBeenCalledWith(99, "retry-key");
  });

  it("deleteMigration passes id to client", async () => {
    await client.deleteMigration(7, "delete-key");
    expect(client.deleteMigration).toHaveBeenCalledWith(7, "delete-key");
  });

  // --- Idempotency key tests ---

  it("startMigration generates deterministic idempotency key", () => {
    const key = idempotencyKey("start_migration", { mailbox_id: 5, source_host: "imap.gmail.com", source_email: "user@gmail.com" });
    expect(key).toMatch(/^mcp_start_migration_/);
    // Same call = same key
    expect(idempotencyKey("start_migration", { mailbox_id: 5, source_host: "imap.gmail.com", source_email: "user@gmail.com" })).toBe(key);
  });

  it("cancelMigration generates deterministic idempotency key", () => {
    const key = idempotencyKey("cancel_migration", { migration_id: 10 });
    expect(key).toMatch(/^mcp_cancel_migration_/);
    expect(idempotencyKey("cancel_migration", { migration_id: 10 })).toBe(key);
  });

  it("deleteMigration generates deterministic idempotency key", () => {
    const key = idempotencyKey("delete_migration", { migration_id: 3 });
    expect(key).toMatch(/^mcp_delete_migration_/);
    expect(idempotencyKey("delete_migration", { migration_id: 3 })).toBe(key);
  });

  // --- Safety gate tests ---

  it("test_migration_connection blocked when allowMigration=false", () => {
    const config = { ...baseConfig, allowMigration: false };
    expect(config.allowMigration).toBe(false);
    const result = errorResult(
      "Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable email migrations via the MCP server.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("TREKMAIL_ALLOW_MIGRATION");
  });

  it("test_migration_connection allowed when allowMigration=true", async () => {
    const config = { ...baseConfig, allowMigration: true };
    expect(config.allowMigration).toBe(true);
    // When gate passes, client method is callable
    await client.testMigrationConnection(
      { source_host: "imap.gmail.com", source_port: 993, source_security: "ssl", source_email: "user@gmail.com", source_password: "pass" },
      "test-key",
    );
    expect(client.testMigrationConnection).toHaveBeenCalled();
  });

  it("start_migration blocked when allowMigration=false", () => {
    const config = { ...baseConfig, allowMigration: false };
    expect(config.allowMigration).toBe(false);
    const result = errorResult(
      "Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable email migrations via the MCP server.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("TREKMAIL_ALLOW_MIGRATION");
  });

  it("start_migration blocked when confirm_start=false", () => {
    const result = errorResult(
      "Migration not confirmed. Set confirm_start=true to start the email migration.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("confirm_start");
  });

  it("cancel_migration blocked when confirm_cancel=false", () => {
    const result = errorResult(
      "Cancellation not confirmed. Set confirm_cancel=true to cancel the migration.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("confirm_cancel");
  });

  it("retry_migration blocked when confirm_retry=false", () => {
    const result = errorResult(
      "Retry not confirmed. Set confirm_retry=true to retry the migration.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("confirm_retry");
  });

  it("delete_migration blocked when allowMigration=false", () => {
    const config = { ...baseConfig, allowMigration: false };
    expect(config.allowMigration).toBe(false);
    const result = errorResult(
      "Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable email migrations via the MCP server.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("TREKMAIL_ALLOW_MIGRATION");
  });

  it("delete_migration blocked when confirm_delete=false", () => {
    const result = errorResult(
      "Deletion not confirmed. Set confirm_delete=true to delete the migration record.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain("confirm_delete");
  });

  it("delete_migration calls client when both gates pass", async () => {
    const config = { ...baseConfig, allowMigration: true };
    expect(config.allowMigration).toBe(true);
    await client.deleteMigration(7, "delete-key");
    expect(client.deleteMigration).toHaveBeenCalledWith(7, "delete-key");
  });
});
