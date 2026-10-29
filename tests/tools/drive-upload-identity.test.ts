import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../../src/client.js";

/**
 * Ticket #517 (2026-10-29): drive_file_upload checked `local_path`, then
 * reopened it by name after the initiate round trip, so a link swapped in
 * meanwhile uploaded a denied file (same-size single PUT, or any multipart
 * part). A hard link to a denied file passed the check with no race at all.
 *
 * The upload must read the very file that was checked. The PUTs go to a real
 * loopback server so undici's Content-Length handling is the production one.
 */

// statSync takes the identity snapshot between the path check and the open:
// the hooks let a test swap the file just before or just after it.
type Hook = null | (() => void);
const hooks = vi.hoisted(() => ({ beforeStat: null as Hook, afterStat: null as Hook }));
vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  const once = (name: "beforeStat" | "afterStat") => {
    const hook = hooks[name];
    hooks[name] = null;
    hook?.();
  };
  return {
    ...real,
    statSync: ((path: fs.PathLike, options?: unknown) => {
      once("beforeStat");
      const stats = (real.statSync as (p: fs.PathLike, o?: unknown) => unknown)(path, options);
      once("afterStat");
      return stats;
    }) as typeof real.statSync,
  };
});

const { registerDriveTools } = await import("../../src/tools/drive.js");

const SECRET = "SECRET-KEY-CANARY-0123456789";

describe("drive_file_upload — uploads the file it checked (ticket #517)", () => {
  let base: string;
  let allowed: string;
  let home: string;
  let canary: string;
  let server: Server;
  let url: string;
  let bodies: Buffer[];
  const oldHome = process.env.HOME;

  beforeEach(async () => {
    base = fs.mkdtempSync(join(tmpdir(), "drive-identity-"));
    allowed = join(base, "allowed");
    fs.mkdirSync(allowed);
    // ~/.ssh is on the hard denylist; HOME points at a fake one.
    home = join(base, "home");
    fs.mkdirSync(join(home, ".ssh"), { recursive: true });
    canary = join(home, ".ssh", "id_canary");
    fs.writeFileSync(canary, SECRET);
    process.env.HOME = home;
    process.env.TREKMAIL_UPLOAD_DIR = allowed;

    bodies = [];
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        bodies.push(Buffer.concat(chunks));
        res.setHeader("etag", '"e"');
        res.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/put`;
  });

  afterEach(async () => {
    hooks.beforeStat = null;
    hooks.afterStat = null;
    process.env.HOME = oldHome;
    delete process.env.TREKMAIL_UPLOAD_DIR;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(base, { recursive: true, force: true });
  });

  function makeHandler(onInitiate: () => void = () => {}, multipart = false) {
    const client = {
      initiateDriveUpload: vi.fn().mockImplementation(async (_space: string, _name: string, size: number) => {
        onInitiate();
        if (!multipart) {
          return { file_id: 1, multipart: false, upload_url: url, headers: {}, part_size_bytes: 0, parts: [] };
        }
        const parts = Array.from({ length: Math.ceil(size / 8) }, (_, i) => ({ part_number: i + 1, upload_url: url }));
        return { file_id: 1, multipart: true, part_size_bytes: 8, parts };
      }),
      completeDriveUpload: vi.fn().mockResolvedValue({ id: 1, status: "available" }),
      abortDriveUpload: vi.fn().mockResolvedValue({ aborted: true }),
      refreshDriveUploadParts: vi.fn(),
    } as unknown as TrekMailClient;

    const server = new McpServer({ name: "test", version: "0.0.0" });
    const handlers = new Map<string, (a: Record<string, unknown>) => Promise<unknown>>();
    const originalRegister = server.registerTool.bind(server);
    server.registerTool = ((name: string, def: unknown, handler: any) => {
      handlers.set(name, handler);
      return originalRegister(name, def as any, handler);
    }) as typeof server.registerTool;
    registerDriveTools(server, client, { allowDestructive: true });

    return { handler: handlers.get("drive_file_upload")!, client };
  }

  type Result = { isError?: boolean; content: Array<{ text: string }> };
  const uploaded = () => Buffer.concat(bodies).toString();

  it("a symlink swapped in during initiate does not change what is uploaded (single PUT)", async () => {
    const path = join(allowed, "report.txt");
    fs.writeFileSync(path, "x".repeat(SECRET.length));
    const { handler } = makeHandler(() => {
      fs.unlinkSync(path);
      fs.symlinkSync(canary, path);
    });

    const r = (await handler({ space: "account", local_path: path })) as Result;

    expect(r.isError).toBeFalsy();
    expect(uploaded()).toBe("x".repeat(SECRET.length));
  });

  it("a symlink swapped in during initiate does not change any multipart part", async () => {
    const path = join(allowed, "report.txt");
    fs.writeFileSync(path, "x".repeat(SECRET.length));
    const { handler } = makeHandler(() => {
      fs.unlinkSync(path);
      fs.symlinkSync(canary, path);
    }, true);

    const r = (await handler({ space: "account", local_path: path })) as Result;

    expect(r.isError).toBeFalsy();
    expect(bodies.length).toBe(4);
    expect(uploaded()).toBe("x".repeat(SECRET.length));
  });

  it("refuses a hard link to a denied file before any API call", async () => {
    const path = join(allowed, "innocent.txt");
    fs.linkSync(canary, path);
    const { handler, client } = makeHandler();

    const r = (await handler({ space: "account", local_path: path })) as Result;

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/2 hard links/);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
    expect(bodies.length).toBe(0);
  });

  it("refuses when the file becomes a symlink between the check and the open", async () => {
    const path = join(allowed, "report.txt");
    fs.writeFileSync(path, "x");
    hooks.afterStat = () => {
      fs.unlinkSync(path);
      fs.symlinkSync(canary, path);
    };
    const { handler, client } = makeHandler();

    const r = (await handler({ space: "account", local_path: path })) as Result;

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/changed while it was being checked/);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it("refuses when a parent directory is swapped for a link to a denied one", async () => {
    // Swapped in before the identity snapshot: stat and open both follow the
    // link to the same denied file, so only the location check can tell.
    const dir = join(allowed, "dir");
    fs.mkdirSync(dir);
    fs.writeFileSync(join(dir, "id_canary"), "x".repeat(SECRET.length));
    hooks.beforeStat = () => {
      fs.renameSync(dir, join(allowed, "dir-moved"));
      fs.symlinkSync(join(home, ".ssh"), dir);
    };
    const { handler, client } = makeHandler();

    const r = (await handler({ space: "account", local_path: join(dir, "id_canary") })) as Result;

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/changed while it was being checked/);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it("the portable location check (macOS / Windows, no /proc) refuses the same swap", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      const dir = join(allowed, "dir");
      fs.mkdirSync(dir);
      fs.writeFileSync(join(dir, "id_canary"), "x");
      hooks.beforeStat = () => {
        fs.renameSync(dir, join(allowed, "dir-moved"));
        fs.symlinkSync(join(home, ".ssh"), dir);
      };
      const { handler, client } = makeHandler();

      const r = (await handler({ space: "account", local_path: join(dir, "id_canary") })) as Result;

      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/changed while it was being checked/);
      expect(client.initiateDriveUpload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it("refuses when another file is renamed over the checked one before the open", async () => {
    const path = join(allowed, "report.txt");
    fs.writeFileSync(path, "x");
    fs.writeFileSync(join(allowed, "other.txt"), "y");
    hooks.afterStat = () => fs.renameSync(join(allowed, "other.txt"), path);
    const { handler, client } = makeHandler();

    const r = (await handler({ space: "account", local_path: path })) as Result;

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/changed while it was being checked/);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")("refuses a FIFO without blocking on it", async () => {
    const fifo = join(allowed, "pipe");
    execFileSync("mkfifo", [fifo]);
    const { handler, client } = makeHandler();

    const r = (await handler({ space: "account", local_path: fifo })) as Result;

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not a regular file/);
    expect(client.initiateDriveUpload).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses an unreadable file before reserving quota",
    async () => {
      const path = join(allowed, "locked.txt");
      fs.writeFileSync(path, "x");
      fs.chmodSync(path, 0o000);
      const { handler, client } = makeHandler();

      const r = (await handler({ space: "account", local_path: path })) as Result;

      expect(r.isError).toBe(true);
      expect(r.content[0].text).toMatch(/does not exist or is unreadable/);
      expect(client.initiateDriveUpload).not.toHaveBeenCalled();
    },
  );

  it("still uploads through a symlink that points at an allowed file", async () => {
    const target = join(allowed, "real.txt");
    fs.writeFileSync(target, "hello");
    const link = join(allowed, "link.txt");
    fs.symlinkSync(target, link);
    const { handler } = makeHandler();

    const r = (await handler({ space: "account", local_path: link })) as Result;

    expect(r.isError).toBeFalsy();
    expect(uploaded()).toBe("hello");
  });

  it.skipIf(process.platform !== "linux")("closes the file after success, refusal and a failed PUT", async () => {
    // Only descriptors on files under this test's directory: fetch keeps its sockets.
    const openFds = () =>
      fs.readdirSync("/proc/self/fd").filter((fd) => {
        try {
          return fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(base);
        } catch {
          return false;
        }
      }).length;
    const path = join(allowed, "ok.txt");
    fs.writeFileSync(path, "hello");
    const linked = join(allowed, "linked.txt");
    fs.linkSync(canary, linked);
    const before = openFds();

    await makeHandler().handler({ space: "account", local_path: path });
    await makeHandler().handler({ space: "account", local_path: linked });
    server.removeAllListeners("request");
    server.on("request", (_req, res) => { res.statusCode = 500; res.end(); });
    const failed = (await makeHandler().handler({ space: "account", local_path: path })) as Result;

    expect(failed.isError).toBe(true);
    expect(openFds()).toBe(before);
  });

  it("still uploads an ordinary file byte for byte", async () => {
    const path = join(allowed, "ok.bin");
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
    fs.writeFileSync(path, bytes);
    const { handler, client } = makeHandler(() => {}, true);

    const r = (await handler({ space: "account", local_path: path })) as Result;

    expect(r.isError).toBeFalsy();
    expect(Buffer.concat(bodies).equals(bytes)).toBe(true);
    expect(client.completeDriveUpload).toHaveBeenCalledTimes(1);
  });
});
