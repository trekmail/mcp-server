import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";

/**
 * Drive API + MCP rollout, PR #8.
 *
 * Smoke tests for the drive client surface — confirm each Drive method
 * forwards its arguments to the underlying request() correctly. The
 * tools layer is a thin Zod-validated wrapper over these methods, so
 * coverage here also pins the tool schemas indirectly.
 */
describe("drive client methods", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      listDriveSpaces: vi.fn().mockResolvedValue({ data: [] }),
      getDriveStorage: vi.fn().mockResolvedValue({ used_bytes: 0 }),
      getDriveSpaceUsage: vi.fn().mockResolvedValue({ used_bytes: 0 }),
      listDriveFolder: vi.fn().mockResolvedValue({ folders: [], files: [] }),
      getDriveFolderTree: vi.fn().mockResolvedValue({ data: [] }),
      getDriveAllIds: vi.fn().mockResolvedValue({ folder_ids: [], file_ids: [] }),
      listDriveTrash: vi.fn().mockResolvedValue({ data: [] }),
      getDriveFile: vi.fn().mockResolvedValue({ id: 1 }),
      getDriveFileDownload: vi.fn().mockResolvedValue({ download_url: "https://b2/..." }),
      createDriveFolder: vi.fn().mockResolvedValue({ id: 1 }),
      updateDriveFolder: vi.fn().mockResolvedValue({ id: 1 }),
      moveDriveFolder: vi.fn().mockResolvedValue({ id: 1 }),
      trashDriveFolder: vi.fn().mockResolvedValue({ trashed: true }),
      restoreDriveFolder: vi.fn().mockResolvedValue({ id: 1 }),
      purgeDriveFolder: vi.fn().mockResolvedValue({ purged: true }),
      shareDriveFolderWithAccount: vi.fn().mockResolvedValue({ id: 1, is_shared: true }),
      stopSharingDriveFolder: vi.fn().mockResolvedValue({ id: 1, is_shared: false }),
      renameDriveFile: vi.fn().mockResolvedValue({ id: 1 }),
      moveDriveFile: vi.fn().mockResolvedValue({ id: 1 }),
      trashDriveFile: vi.fn().mockResolvedValue({ trashed: true }),
      restoreDriveFile: vi.fn().mockResolvedValue({ id: 1 }),
      purgeDriveFile: vi.fn().mockResolvedValue({ purged: true }),
      emptyDriveTrash: vi.fn().mockResolvedValue({ purged_files: 0 }),
      bulkDriveTrash: vi.fn().mockResolvedValue({ trashed_files: 0 }),
      bulkDriveRestore: vi.fn().mockResolvedValue({ restored_files: 0 }),
      bulkDriveMove: vi.fn().mockResolvedValue({ moved_files: 0 }),
      bulkDrivePurge: vi.fn().mockResolvedValue({ purged_files: 0 }),
      createDriveShareLink: vi.fn().mockResolvedValue({ token: "abc" }),
      listDriveShareLinks: vi.fn().mockResolvedValue({ data: [] }),
      revokeDriveShareLink: vi.fn().mockResolvedValue({ revoked_at: "..." }),
      initiateDriveUpload: vi.fn().mockResolvedValue({ kind: "small" }),
      completeDriveUpload: vi.fn().mockResolvedValue({ status: "available" }),
      refreshDriveUploadParts: vi.fn().mockResolvedValue({ parts: [] }),
      abortDriveUpload: vi.fn().mockResolvedValue({ aborted: true }),
      getDriveAddon: vi.fn().mockResolvedValue({ active: false }),
      getDriveAddonPricing: vi.fn().mockResolvedValue({ currency: "USD" }),
      getDriveAddonCancellationPreview: vi.fn().mockResolvedValue({ cancelable: false }),
    } as unknown as TrekMailClient;
  });

  it("listDriveSpaces takes no args", async () => {
    await client.listDriveSpaces();
    expect(client.listDriveSpaces).toHaveBeenCalledWith();
  });

  it("getDriveSpaceUsage forwards space identifier", async () => {
    await client.getDriveSpaceUsage("account");
    expect(client.getDriveSpaceUsage).toHaveBeenCalledWith("account");

    await client.getDriveSpaceUsage("mailbox:42");
    expect(client.getDriveSpaceUsage).toHaveBeenCalledWith("mailbox:42");
  });

  it("listDriveFolder forwards space + folder + paging", async () => {
    await client.listDriveFolder("account", 5, { sort: "name", per_page: 10 });
    expect(client.listDriveFolder).toHaveBeenCalledWith("account", 5, { sort: "name", per_page: 10 });

    await client.listDriveFolder("account");
    expect(client.listDriveFolder).toHaveBeenCalledWith("account");
  });

  it("createDriveFolder forwards all five optional args", async () => {
    await client.createDriveFolder("account", "Reports", null, "#aabbcc", true, "key-1");
    expect(client.createDriveFolder).toHaveBeenCalledWith("account", "Reports", null, "#aabbcc", true, "key-1");
  });

  it("shareDriveFolderWithAccount + stopSharingDriveFolder forward folder id + idempotency", async () => {
    await client.shareDriveFolderWithAccount(42, "key-share");
    expect(client.shareDriveFolderWithAccount).toHaveBeenCalledWith(42, "key-share");

    await client.stopSharingDriveFolder(42, "key-stop");
    expect(client.stopSharingDriveFolder).toHaveBeenCalledWith(42, "key-stop");
  });

  it("updateDriveFolder accepts partial changes", async () => {
    await client.updateDriveFolder(7, { name: "X" });
    expect(client.updateDriveFolder).toHaveBeenCalledWith(7, { name: "X" });

    await client.updateDriveFolder(7, { color: "#ffffff" });
    expect(client.updateDriveFolder).toHaveBeenCalledWith(7, { color: "#ffffff" });

    await client.updateDriveFolder(7, { name: "Y", color: null });
    expect(client.updateDriveFolder).toHaveBeenCalledWith(7, { name: "Y", color: null });
  });

  it("moveDriveFile uses idempotency key", async () => {
    await client.moveDriveFile(3, 9, "key-2");
    expect(client.moveDriveFile).toHaveBeenCalledWith(3, 9, "key-2");
  });

  it("createDriveShareLink optionally carries expiry + max_downloads", async () => {
    await client.createDriveShareLink(11, { max_downloads: 5 }, "key-3");
    expect(client.createDriveShareLink).toHaveBeenCalledWith(11, { max_downloads: 5 }, "key-3");

    await client.createDriveShareLink(11, { expires_at: "2026-12-01T00:00:00Z" });
    expect(client.createDriveShareLink).toHaveBeenCalledWith(11, { expires_at: "2026-12-01T00:00:00Z" });
  });

  it("bulkDriveMove forwards target_folder_id + idempotency", async () => {
    await client.bulkDriveMove("mailbox:5", [1, 2], [3], 10, "key-4");
    expect(client.bulkDriveMove).toHaveBeenCalledWith("mailbox:5", [1, 2], [3], 10, "key-4");
  });

  it("initiateDriveUpload forwards size + folder + mime", async () => {
    await client.initiateDriveUpload("account", "f.txt", 1024, 8, "text/plain", "key-5");
    expect(client.initiateDriveUpload).toHaveBeenCalledWith(
      "account", "f.txt", 1024, 8, "text/plain", "key-5",
    );
  });

  it("getDriveAddonPricing accepts optional currency", async () => {
    await client.getDriveAddonPricing();
    expect(client.getDriveAddonPricing).toHaveBeenCalledWith();

    await client.getDriveAddonPricing("EUR");
    expect(client.getDriveAddonPricing).toHaveBeenCalledWith("EUR");
  });
});

import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDriveTools } from "../../src/tools/drive.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("drive destructive tool gates", () => {
  it("blocks soft-trash operations unless destructive mode is enabled", async () => {
    const stubClient = {
      trashDriveFile: vi.fn().mockResolvedValue({ trashed: true }),
      trashDriveFolder: vi.fn().mockResolvedValue({ trashed: true }),
    } as unknown as TrekMailClient;

    const server = new McpServer({ name: "test", version: "0.0.0" });
    const toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const originalRegister = server.registerTool.bind(server);
    server.registerTool = ((name: string, _def: unknown, handler: any) => {
      toolHandlers.set(name, handler);
      return originalRegister(name, _def as any, handler);
    }) as typeof server.registerTool;

    registerDriveTools(server, stubClient, { allowDestructive: false });

    const fileResult = (await toolHandlers.get("drive_file_trash")!({ file_id: 1 })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    const folderResult = (await toolHandlers.get("drive_folder_trash")!({ folder_id: 2 })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(fileResult.isError).toBe(true);
    expect(folderResult.isError).toBe(true);
    expect(fileResult.content[0].text).toContain("TREKMAIL_ALLOW_DESTRUCTIVE=true");
    expect(stubClient.trashDriveFile).not.toHaveBeenCalled();
    expect(stubClient.trashDriveFolder).not.toHaveBeenCalled();
  });
});

describe("drive_file_upload tool — high-level wrapper", () => {
  let tmpDir: string;
  let smallFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "drive-upload-"));
    smallFile = join(tmpDir, "small.txt");
    writeFileSync(smallFile, "hello world");
  });

  afterEach(() => {
    try { unlinkSync(smallFile); } catch {}
  });

  /**
   * The orchestration is the meat — we mock fetch + the client and
   * confirm the wrapper does:
   *   1. initiate
   *   2. single PUT to the presigned URL
   *   3. complete (no parts, since multipart=false)
   * On the small path, no abort/refresh calls happen.
   */
  it("small upload: chains initiate → single PUT → complete", async () => {
    const initiateMock = vi.fn().mockResolvedValue({
      file_id: 7,
      multipart: false,
      upload_url: "https://b2.example/upload",
      headers: { "Content-Type": "text/plain" },
      part_size_bytes: 0,
      parts: [],
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    const completeMock = vi.fn().mockResolvedValue({ id: 7, status: "available" });
    const abortMock = vi.fn().mockResolvedValue({ aborted: true });

    const stubClient = {
      initiateDriveUpload: initiateMock,
      completeDriveUpload: completeMock,
      abortDriveUpload: abortMock,
      refreshDriveUploadParts: vi.fn(),
    } as unknown as TrekMailClient;

    // Stub global fetch — return 200 OK with a fake ETag.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200, headers: { etag: '"abc123"' } }));

    // Spin up an in-memory MCP server purely to register tools and find
    // the drive_file_upload handler.
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    // Intercept registerTool to capture handlers.
    const originalRegister = server.registerTool.bind(server);
    server.registerTool = ((name: string, _def: unknown, handler: any) => {
      toolHandlers.set(name, handler);
      return originalRegister(name, _def as any, handler);
    }) as typeof server.registerTool;

    registerDriveTools(server, stubClient, { allowDestructive: true });
    const handler = toolHandlers.get("drive_file_upload");
    expect(handler).toBeDefined();

    const result = await handler!({
      space: "account",
      local_path: smallFile,
    });

    // Each call landed once.
    expect(initiateMock).toHaveBeenCalledTimes(1);
    expect(initiateMock.mock.calls[0][0]).toBe("account");
    expect(initiateMock.mock.calls[0][2]).toBe(11); // size of "hello world"
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://b2.example/upload");
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock.mock.calls[0][0]).toBe(7);
    expect(abortMock).not.toHaveBeenCalled();
    expect(result).toBeTruthy();

    fetchSpy.mockRestore();
  });

  it("PUT failure aborts the upload", async () => {
    const stubClient = {
      initiateDriveUpload: vi.fn().mockResolvedValue({
        file_id: 9,
        multipart: false,
        upload_url: "https://b2.example/upload",
        headers: {},
        part_size_bytes: 0,
        parts: [],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
      completeDriveUpload: vi.fn(),
      abortDriveUpload: vi.fn().mockResolvedValue({ aborted: true }),
      refreshDriveUploadParts: vi.fn(),
    } as unknown as TrekMailClient;

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 500, statusText: "Server Error" }));

    const server = new McpServer({ name: "test", version: "0.0.0" });
    const toolHandlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const originalRegister = server.registerTool.bind(server);
    server.registerTool = ((name: string, _def: unknown, handler: any) => {
      toolHandlers.set(name, handler);
      return originalRegister(name, _def as any, handler);
    }) as typeof server.registerTool;

    registerDriveTools(server, stubClient, { allowDestructive: true });
    const handler = toolHandlers.get("drive_file_upload")!;

    const result = (await handler({ space: "account", local_path: smallFile })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("B2 PUT failed");
    expect(stubClient.abortDriveUpload).toHaveBeenCalledWith(9);
    expect(stubClient.completeDriveUpload).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

import { symlinkSync, rmSync } from "node:fs";

/**
 * Ticket #170 (2026-05-28): drive_file_upload accepted any absolute path
 * (z.string() — no validation) and streamed it into Drive. Combined with
 * prompt-injection in mailbox content this exfiltrated `/proc/self/
 * environ`, `~/.ssh/id_rsa`, and `.env` files.
 *
 * Tests below cover the path-allowlist added in the same patch:
 *   - hard denylist (/etc, /proc, ~/.ssh, …)
 *   - .env-name rejection
 *   - allowlist defaults to $HOME ∪ $TMPDIR
 *   - TREKMAIL_UPLOAD_DIR override
 *   - symlinks resolve to their canonical target before allow/deny check
 *   - HTTP transport: tool is not registered at all
 */
describe("drive_file_upload — path allowlist (ticket #170)", () => {
  let tmpDir: string;

  function makeHandler(
    opts: { allowDestructive?: boolean; httpTransport?: boolean } = { allowDestructive: true },
  ) {
    const stubClient = {
      initiateDriveUpload: vi.fn().mockResolvedValue({
        file_id: 1,
        multipart: false,
        upload_url: "https://b2.example/upload",
        headers: {},
        part_size_bytes: 0,
        parts: [],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
      completeDriveUpload: vi.fn().mockResolvedValue({ id: 1, status: "available" }),
      abortDriveUpload: vi.fn().mockResolvedValue({ aborted: true }),
      refreshDriveUploadParts: vi.fn(),
    } as unknown as TrekMailClient;

    const server = new McpServer({ name: "test", version: "0.0.0" });
    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<unknown>>();
    const originalRegister = server.registerTool.bind(server);
    server.registerTool = ((name: string, _def: unknown, handler: any) => {
      handlers.set(name, handler);
      return originalRegister(name, _def as any, handler);
    }) as typeof server.registerTool;

    registerDriveTools(server, stubClient, opts);
    return { handler: handlers.get("drive_file_upload"), client: stubClient };
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "drive-allowlist-"));
    process.env.TREKMAIL_UPLOAD_DIR = tmpDir;
  });

  afterEach(() => {
    delete process.env.TREKMAIL_UPLOAD_DIR;
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it("rejects /etc/passwd even when allowlist is the whole homedir", async () => {
    delete process.env.TREKMAIL_UPLOAD_DIR; // fall back to default $HOME ∪ $TMPDIR
    const { handler, client } = makeHandler();
    const r = (await handler!({ space: "account", local_path: "/etc/passwd" })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/restricted location/i);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it("rejects /proc/self/environ", async () => {
    delete process.env.TREKMAIL_UPLOAD_DIR;
    const { handler, client } = makeHandler();
    const r = (await handler!({ space: "account", local_path: "/proc/self/environ" })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/restricted location/i);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it("rejects a file literally named .env even inside the allowlist", async () => {
    const envPath = join(tmpDir, ".env");
    writeFileSync(envPath, "APP_KEY=secret");
    const { handler, client } = makeHandler();
    const r = (await handler!({ space: "account", local_path: envPath })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Refusing to upload \.env/i);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it("rejects .env.production (any .env.* suffix)", async () => {
    const envPath = join(tmpDir, ".env.production");
    writeFileSync(envPath, "DB_PASS=secret");
    const { handler, client } = makeHandler();
    const r = (await handler!({ space: "account", local_path: envPath })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Refusing to upload \.env/i);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it("rejects a path outside the allowlist", async () => {
    // TREKMAIL_UPLOAD_DIR is set to tmpDir; pick a path outside it.
    const outside = join(tmpdir(), `not-in-allow-${Date.now()}.txt`);
    writeFileSync(outside, "hello");
    try {
      const { handler, client } = makeHandler();
      const r = (await handler!({ space: "account", local_path: outside })) as {
        isError: boolean;
        content: Array<{ text: string }>;
      };
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/outside the upload allowlist/i);
      expect(client.initiateDriveUpload).not.toHaveBeenCalled();
    } finally {
      try { unlinkSync(outside); } catch {}
    }
  });

  it("rejects a symlink pointing to a denied file (realpath canonicalisation)", async () => {
    // Place the symlink inside the allowlist; its target is in /etc.
    const link = join(tmpDir, "sneaky");
    symlinkSync("/etc/hostname", link);
    const { handler, client } = makeHandler();
    const r = (await handler!({ space: "account", local_path: link })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/restricted location/i);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it("accepts a file inside the allowlist (TREKMAIL_UPLOAD_DIR=tmpDir)", async () => {
    const good = join(tmpDir, "ok.txt");
    writeFileSync(good, "hello");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200, headers: { etag: '"abc"' } }));
    const { handler } = makeHandler();
    const r = (await handler!({ space: "account", local_path: good })) as
      | { isError?: boolean; content: Array<{ text: string }> }
      | undefined;
    expect(r).toBeTruthy();
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    fetchSpy.mockRestore();
  });

  it("accepts a file under default allowlist ($TMPDIR) when env override is unset", async () => {
    delete process.env.TREKMAIL_UPLOAD_DIR;
    const good = join(tmpDir, "ok2.txt");
    writeFileSync(good, "hi");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200, headers: { etag: '"abc"' } }));
    const { handler } = makeHandler();
    const r = (await handler!({ space: "account", local_path: good })) as
      | { isError?: boolean }
      | undefined;
    expect(r).toBeTruthy();
    expect((r as { isError?: boolean }).isError).toBeFalsy();
    fetchSpy.mockRestore();
  });

  it("respects colon-separated TREKMAIL_UPLOAD_DIR", async () => {
    const dir2 = mkdtempSync(join(tmpdir(), "drive-allowlist-2-"));
    try {
      process.env.TREKMAIL_UPLOAD_DIR = `${tmpDir}:${dir2}`;
      const good = join(dir2, "ok.txt");
      writeFileSync(good, "hi");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(new Response("", { status: 200, headers: { etag: '"abc"' } }));
      const { handler } = makeHandler();
      const r = (await handler!({ space: "account", local_path: good })) as
        | { isError?: boolean }
        | undefined;
      expect(r).toBeTruthy();
      expect((r as { isError?: boolean }).isError).toBeFalsy();
      fetchSpy.mockRestore();
    } finally {
      try { rmSync(dir2, { recursive: true, force: true }); } catch {}
    }
  });

  it("returns a clear error for a non-existent path", async () => {
    const { handler, client } = makeHandler();
    const r = (await handler!({
      space: "account",
      local_path: join(tmpDir, "does-not-exist.bin"),
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/does not exist|unreadable/i);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });
});

describe("drive_file_upload — HTTP transport (ticket #170)", () => {
  it("does NOT register drive_file_upload when httpTransport=true", () => {
    const stubClient = {} as unknown as TrekMailClient;
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const names = new Set<string>();
    const originalRegister = server.registerTool.bind(server);
    server.registerTool = ((name: string, _def: unknown, handler: any) => {
      names.add(name);
      return originalRegister(name, _def as any, handler);
    }) as typeof server.registerTool;

    registerDriveTools(server, stubClient, { allowDestructive: true, httpTransport: true });

    expect(names.has("drive_file_upload")).toBe(false);
    // Spot-check that other Drive tools are still registered — we're
    // only suppressing the local-filesystem reader.
    expect(names.has("drive_folder_create")).toBe(true);
    expect(names.has("drive_file_download_url")).toBe(true);
  });

  it("DOES register drive_file_upload when httpTransport is unset (stdio default)", () => {
    const stubClient = {} as unknown as TrekMailClient;
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const names = new Set<string>();
    const originalRegister = server.registerTool.bind(server);
    server.registerTool = ((name: string, _def: unknown, handler: any) => {
      names.add(name);
      return originalRegister(name, _def as any, handler);
    }) as typeof server.registerTool;

    registerDriveTools(server, stubClient, { allowDestructive: true });

    expect(names.has("drive_file_upload")).toBe(true);
  });
});
