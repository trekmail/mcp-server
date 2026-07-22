import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TOOL_CATALOG,
  TOOL_CATALOG_BY_NAME,
  TOOL_CATALOG_HASH,
  TOOL_CATALOG_VERSION,
  toolsForToolsets,
} from "../src/tool-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const toolsDir = join(__dirname, "../src/tools");

function registeredToolNames(): Set<string> {
  const names = new Set<string>();
  for (const file of readdirSync(toolsDir)) {
    if (!file.endsWith(".ts")) continue;
    const source = readFileSync(join(toolsDir, file), "utf8");
    for (const match of source.matchAll(/registerTool\(\s*"([^"]+)"/gs)) {
      names.add(match[1]!);
    }
  }
  return names;
}

describe("tool catalog", () => {
  it("has an explicit version and deterministic parity hash", () => {
    expect(TOOL_CATALOG_VERSION).toBe("2026-07-22.2");
    expect(TOOL_CATALOG_HASH).toBe("c8a16ff4");
  });

  it("covers all 228 registered tools exactly once", () => {
    const registered = registeredToolNames();
    const catalogued = new Set(TOOL_CATALOG.map((entry) => entry.name));

    expect(registered.size).toBe(228);
    expect(TOOL_CATALOG).toHaveLength(228);
    expect(TOOL_CATALOG_BY_NAME.size).toBe(228);
    expect([...registered].filter((name) => !catalogued.has(name))).toEqual([]);
    expect([...catalogued].filter((name) => !registered.has(name))).toEqual([]);
  });

  it("keeps Dashboard and Webmail Drive in one toolset", () => {
    const drive = toolsForToolsets(["drive"]);
    expect(drive.size).toBe(38);
    expect(drive.has("drive_browse_folder")).toBe(true);
    expect(drive.has("drive_file_upload")).toBe(true);
    expect(drive.has("drive_device_create")).toBe(false);
  });

  it("keeps credential minting out of normal Drive and email sets", () => {
    const credentials = toolsForToolsets(["credentials"]);
    expect(credentials.size).toBe(7);
    expect(credentials.has("create_message_token")).toBe(true);
    expect(credentials.has("drive_device_create")).toBe(true);

    const projectTools = toolsForToolsets(["email", "drive"]);
    for (const name of credentials) {
      expect(projectTools.has(name), name).toBe(false);
    }
  });

  it("keeps the small email preset separate from optional webmail features", () => {
    expect(toolsForToolsets(["email"]).size).toBe(19);
    expect(toolsForToolsets(["email_settings"]).size).toBe(27);
    expect(toolsForToolsets(["contacts"]).size).toBe(14);
    expect(toolsForToolsets(["calendar"]).size).toBe(5);
  });

  it("marks only local-path upload as stdio-only", () => {
    const stdioOnly = TOOL_CATALOG.filter(
      (entry) => entry.transports.length === 1 && entry.transports[0] === "stdio",
    );
    expect(stdioOnly.map((entry) => entry.name)).toEqual(["drive_file_upload"]);
  });

  it("stores granular capability and access metadata for every tool", () => {
    for (const entry of TOOL_CATALOG) {
      expect(entry.anyOfCapabilities.length, entry.name).toBeGreaterThan(0);
      expect(["read", "write", "destructive"]).toContain(entry.access);
    }

    expect(TOOL_CATALOG_BY_NAME.get("list_domains")?.anyOfCapabilities)
      .toEqual(["domains:read"]);
    expect(TOOL_CATALOG_BY_NAME.get("drive_browse_folder")?.anyOfCapabilities)
      .toEqual(["drive:account:read", "drive:mailbox:read"]);
    expect(TOOL_CATALOG_BY_NAME.get("drive_share_list")?.anyOfCapabilities)
      .toEqual(["drive:account:share", "drive:mailbox:share"]);
    expect(TOOL_CATALOG_BY_NAME.get("delete_message")?.access)
      .toBe("destructive");
    expect(TOOL_CATALOG_BY_NAME.get("send_message")?.safetyGate)
      .toBe("sending");
    expect(TOOL_CATALOG_BY_NAME.get("start_migration")?.safetyGate)
      .toBe("migration");
    expect(TOOL_CATALOG_BY_NAME.get("cancel_migration")?.safetyGate)
      .toBeUndefined();
  });
});
