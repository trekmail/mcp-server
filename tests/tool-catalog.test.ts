import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TOOL_CATALOG,
  TOOL_CATALOG_BY_NAME,
  TOOL_CATALOG_HASH,
  hasCapabilityForTool,
  TOOL_CATALOG_VERSION,
  fitsResourceConstraints,
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
    expect(TOOL_CATALOG_VERSION).toBe("2026-10-14.3");
    expect(TOOL_CATALOG_HASH).toBe("7547bd70");
  });

  it("covers all 284 registered tools exactly once", () => {
    const registered = registeredToolNames();
    const catalogued = new Set(TOOL_CATALOG.map((entry) => entry.name));

    expect(registered.size).toBe(284);
    expect(TOOL_CATALOG).toHaveLength(284);
    expect(TOOL_CATALOG_BY_NAME.size).toBe(284);
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
    expect(credentials.size).toBe(8);
    expect(credentials.has("create_message_token")).toBe(true);
    expect(credentials.has("drive_device_create")).toBe(true);

    const projectTools = toolsForToolsets(["email", "drive"]);
    for (const name of credentials) {
      expect(projectTools.has(name), name).toBe(false);
    }
  });

  it("keeps the small email preset separate from optional webmail features", () => {
    // 21 since get_message_delivery and get_mailbox_sending_limits joined
    // send_message: an agent that sends needs to know whether it went out.
    expect(toolsForToolsets(["email"]).size).toBe(21);
    expect(toolsForToolsets(["email_settings"]).size).toBe(36);
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
    expect(TOOL_CATALOG_BY_NAME.get("get_domain_connect_setup")?.anyOfCapabilities)
      .toEqual(["domains:dns:read"]);
    expect(TOOL_CATALOG_BY_NAME.get("get_domain_connect_setup")?.access)
      .toBe("read");
    expect(TOOL_CATALOG_BY_NAME.get("drive_browse_folder")?.anyOfCapabilities)
      .toEqual(["drive:account:read", "drive:mailbox:read"]);
    expect(TOOL_CATALOG_BY_NAME.get("drive_share_list")?.anyOfCapabilities)
      .toEqual(["drive:account:share", "drive:mailbox:share"]);
    expect(TOOL_CATALOG_BY_NAME.get("get_white_label_member_activity")?.allOfCapabilities)
      .toEqual(["members:read"]);
    expect(TOOL_CATALOG_BY_NAME.get("delete_message")?.access)
      .toBe("destructive");
    expect(TOOL_CATALOG_BY_NAME.get("send_message")?.safetyGate)
      .toBe("sending");
    expect(TOOL_CATALOG_BY_NAME.get("start_migration")?.safetyGate)
      .toBe("migration");
    expect(TOOL_CATALOG_BY_NAME.get("cancel_migration")?.safetyGate)
      .toBeUndefined();
  });

  it("puts client storage limits on the member scopes and mailbox storage on mailboxes:write", () => {
    // Same scopes as their REST routes (ticket #482). Reading a limit is safe;
    // changing one or a mailbox's size is behind the destructive gate, and
    // removing a limit is the destructive one.
    expect(TOOL_CATALOG_BY_NAME.get("list_client_limits")).toEqual({
      name: "list_client_limits",
      toolset: "white_label",
      transports: ["stdio", "http"],
      anyOfCapabilities: ["members:read"],
      allOfCapabilities: [],
      access: "read",
      safetyGate: undefined,
      requiresAllDomains: false,
      requiresAllMailboxes: false,
    });
    expect(TOOL_CATALOG_BY_NAME.get("set_client_limit")).toMatchObject({
      toolset: "white_label",
      anyOfCapabilities: ["members:write"],
      allOfCapabilities: [],
      access: "write",
      safetyGate: "destructive",
    });
    expect(TOOL_CATALOG_BY_NAME.get("remove_client_limit")).toMatchObject({
      toolset: "white_label",
      anyOfCapabilities: ["members:write"],
      allOfCapabilities: [],
      access: "destructive",
      safetyGate: "destructive",
    });
    expect(TOOL_CATALOG_BY_NAME.get("set_mailbox_storage")).toMatchObject({
      toolset: "mail_admin",
      anyOfCapabilities: ["mailboxes:write"],
      allOfCapabilities: [],
      access: "write",
      safetyGate: "destructive",
    });
    expect(toolsForToolsets(["white_label"]).size).toBe(23);

    // Linking existing Cloudflare domains takes cloudflare:write alone; Laravel
    // asks for domains:create only when an entry adds a domain.
    expect(TOOL_CATALOG_BY_NAME.get("connect_cloudflare_domains")).toMatchObject({
      anyOfCapabilities: ["cloudflare:write"],
      allOfCapabilities: [],
    });
  });

  it("flags exactly the tools the API refuses to every confined caller", () => {
    // Verified against the PHP (ticket #482): AccountController::update refuses
    // a domain- or mailbox-confined caller; WhiteLabelClientLimitController::
    // constrainedWriterRefusal refuses a domain-confined member or key. Tools
    // that a confined caller can still use with other arguments are not here.
    expect(TOOL_CATALOG.filter((entry) => entry.requiresAllDomains).map((entry) => entry.name).sort())
      .toEqual(["remove_client_limit", "set_client_limit", "update_account"]);
    // drive_folder_stop_sharing: Api\V1\Drive\FolderController::stopSharing
    // refuses a mailbox-confined caller (no mailbox stops a share, as in
    // webmail) and is a no-op on a folder that is not shared.
    expect(TOOL_CATALOG.filter((entry) => entry.requiresAllMailboxes).map((entry) => entry.name).sort())
      .toEqual(["drive_folder_stop_sharing", "update_account"]);

    const confined = { domainIds: [7], mailboxIds: null };
    const mailboxOnly = { domainIds: null, mailboxIds: [9] };
    const everything = { domainIds: null, mailboxIds: null };
    for (const name of ["set_client_limit", "remove_client_limit", "update_account"]) {
      expect(fitsResourceConstraints(name, confined), name).toBe(false);
      expect(fitsResourceConstraints(name, everything), name).toBe(true);
      expect(fitsResourceConstraints(name, undefined), name).toBe(true);
    }
    // A confined reader still sees the limits on its own domains.
    expect(fitsResourceConstraints("list_client_limits", confined)).toBe(true);
    expect(fitsResourceConstraints("update_account", mailboxOnly)).toBe(false);
    expect(fitsResourceConstraints("set_client_limit", mailboxOnly)).toBe(true);
    // Stopping a share is refused to a mailbox-confined caller only; Account
    // Drive has no domain, so a domain-confined one keeps it.
    expect(fitsResourceConstraints("drive_folder_stop_sharing", mailboxOnly)).toBe(false);
    expect(fitsResourceConstraints("drive_folder_stop_sharing", confined)).toBe(true);
    expect(fitsResourceConstraints("drive_folder_stop_sharing", everything)).toBe(true);
    // Each of these still has a use inside the connection's mailboxes.
    for (const name of ["drive_trash_empty", "drive_folder_share_with_account", "drive_folder_create", "drive_upload_initiate"]) {
      expect(fitsResourceConstraints(name, mailboxOnly), name).toBe(true);
    }
  });

  it("asks drive:account:share as well as write to share a folder or stop sharing it", () => {
    for (const name of ["drive_folder_share_with_account", "drive_folder_stop_sharing"]) {
      expect(TOOL_CATALOG_BY_NAME.get(name), name).toMatchObject({
        anyOfCapabilities: ["drive:account:write"],
        allOfCapabilities: ["drive:account:share"],
      });
      expect(hasCapabilityForTool(name, ["drive:account:write"]), name).toBe(false);
      expect(hasCapabilityForTool(name, ["drive:account:write", "drive:account:share"]), name).toBe(true);
    }
    // A plain create keeps the write-only contract (a shared create is
    // refused by the API without the share scope).
    expect(hasCapabilityForTool("drive_folder_create", ["drive:mailbox:write"])).toBe(true);
  });
});
