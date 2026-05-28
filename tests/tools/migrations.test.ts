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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerMigrationTools } from "../../src/tools/migrations.js";

/**
 * Ticket #174 (2026-05-28) — preview_bulk_migration and start_bulk_migration
 * accepted source_host without the isPrivateHost() guard that's already in
 * place on test_migration_connection (line 36) and start_migration (line 119).
 * Backend SafeExternalHost still resolved + range-checked each IMAP
 * connection, but the MCP-layer early-fail was missing — same severity
 * class as the encoding-bypass closed in ticket #171.
 *
 * Tests below pin both bulk handlers to:
 *   - reject source_host of well-known private/IMDS IPs (incl. the
 *     Alibaba 100.100.100.200 that landed in #171)
 *   - allow legitimate provider hostnames (imap.gmail.com, etc.) so we
 *     don't break real bulk migrations
 *   - allow requests with no top-level source_host (provider-based or
 *     per_row_server=true; backend handles per-row hosts)
 */
describe("bulk migration SSRF guard (ticket #174)", () => {
  function buildHandlers(config: Partial<Config> = {}) {
    const cfg: Config = {
      baseUrl: "https://trekmail.test",
      apiToken: "tm_live_test",
      timeoutMs: 30_000,
      userAgent: "test",
      allowDestructive: true,
      allowSending: true,
      allowMigration: true,
      ...config,
    } as Config;
    const stubClient = {
      previewBulkMigration: vi.fn().mockResolvedValue({ data: { valid: 0, invalid: 0, warnings: 0 } }),
      startBulkMigration: vi.fn().mockResolvedValue({ data: { id: 1, status: "queued" } }),
      // ...other client methods unused here
    } as unknown as TrekMailClient;

    const server = new McpServer({ name: "test", version: "0.0.0" });
    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<unknown>>();
    const orig = server.registerTool.bind(server);
    server.registerTool = ((name: string, def: unknown, h: any) => {
      handlers.set(name, h);
      return orig(name, def as any, h);
    }) as typeof server.registerTool;

    registerMigrationTools(server, stubClient, cfg);
    return { handlers, stubClient };
  }

  for (const tool of ["preview_bulk_migration", "start_bulk_migration"] as const) {
    describe(tool, () => {
      it(`rejects source_host=169.254.169.254 (AWS/Azure IMDS)`, async () => {
        const { handlers, stubClient } = buildHandlers();
        const h = handlers.get(tool)!;
        const r = (await h({
          data: "u@x,p,d@y",
          provider: "generic_imap",
          source_host: "169.254.169.254",
          source_port: 993,
          source_security: "ssl",
          confirm_start: true,
        })) as { isError: boolean; content: Array<{ text: string }> };
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toMatch(/private\/internal/i);
        expect(stubClient.previewBulkMigration).not.toHaveBeenCalled();
        expect(stubClient.startBulkMigration).not.toHaveBeenCalled();
      });

      it(`rejects source_host=100.100.100.200 (Alibaba Cloud IMDS, ticket #171)`, async () => {
        const { handlers, stubClient } = buildHandlers();
        const h = handlers.get(tool)!;
        const r = (await h({
          data: "u@x,p,d@y",
          provider: "generic_imap",
          source_host: "100.100.100.200",
          source_port: 993,
          source_security: "ssl",
          confirm_start: true,
        })) as { isError: boolean; content: Array<{ text: string }> };
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toMatch(/private\/internal/i);
        expect(stubClient.previewBulkMigration).not.toHaveBeenCalled();
        expect(stubClient.startBulkMigration).not.toHaveBeenCalled();
      });

      it(`rejects source_host=127.0.0.1`, async () => {
        const { handlers, stubClient } = buildHandlers();
        const h = handlers.get(tool)!;
        const r = (await h({
          data: "u@x,p,d@y",
          provider: "generic_imap",
          source_host: "127.0.0.1",
          source_port: 993,
          source_security: "ssl",
          confirm_start: true,
        })) as { isError: boolean; content: Array<{ text: string }> };
        expect(r.isError).toBe(true);
        expect(stubClient.previewBulkMigration).not.toHaveBeenCalled();
        expect(stubClient.startBulkMigration).not.toHaveBeenCalled();
      });

      it(`allows source_host=imap.gmail.com (sanity, no regression)`, async () => {
        const { handlers, stubClient } = buildHandlers();
        const h = handlers.get(tool)!;
        const r = (await h({
          data: "u@x,p,d@y",
          provider: "generic_imap",
          source_host: "imap.gmail.com",
          source_port: 993,
          source_security: "ssl",
          confirm_start: true,
        })) as { isError?: boolean };
        expect(r.isError).toBeFalsy();
        // One of the two client methods must have been called — both
        // assertions cheap to keep regardless of which tool we ran.
        const called =
          (stubClient.previewBulkMigration as ReturnType<typeof vi.fn>).mock.calls.length +
          (stubClient.startBulkMigration as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(called).toBe(1);
      });

      it(`allows requests with no top-level source_host (provider-based or per_row_server)`, async () => {
        const { handlers, stubClient } = buildHandlers();
        const h = handlers.get(tool)!;
        const r = (await h({
          data: "u@x,p,d@y,imap.gmail.com,993,ssl",
          per_row_server: true,
          confirm_start: true,
        })) as { isError?: boolean };
        expect(r.isError).toBeFalsy();
        const called =
          (stubClient.previewBulkMigration as ReturnType<typeof vi.fn>).mock.calls.length +
          (stubClient.startBulkMigration as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(called).toBe(1);
      });
    });
  }
});
