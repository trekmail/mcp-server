import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import type { TrekMailClient } from "../src/client.js";
import { withToolFilter, type ToolFilterOptions } from "../src/tool-filter.js";
import { TOOL_CATALOG } from "../src/tool-catalog.js";
import { registerInfraTools, registerMessageTools } from "../src/tools/index.js";

const client = new Proxy(
  {},
  { get: () => async () => ({}) },
) as TrekMailClient;

const config: Config = {
  baseUrl: "https://test.invalid",
  apiToken: "tm_live_test",
  messageToken: "tm_msg_test",
  timeoutMs: 1,
  userAgent: "test",
  allowDestructive: true,
  allowSending: true,
  allowMigration: true,
  scopeAwareRegistration: false,
  readOnly: false,
  httpTransport: false,
};

function namesFor(
  toolsets?: Config["toolsets"],
  capabilities?: readonly string[],
  readOnly = false,
  safety?: { destructive: boolean; sending: boolean; migration: boolean },
  constraints?: ToolFilterOptions["constraints"],
): string[] {
  const server = new McpServer({ name: "test", version: "1" });
  const filtered = withToolFilter(server, {
    transport: "stdio",
    toolsets,
    capabilities,
    readOnly,
    safety,
    constraints,
  });
  registerInfraTools(filtered, client, config);
  registerMessageTools(filtered, client, config);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.keys((server as any)._registeredTools as Record<string, unknown>);
}

describe("stdio toolset filtering", () => {
  it("requires shared mailbox permissions in addition to mailbox grants", () => {
    const mailboxOnly = namesFor(undefined, ["mailboxes:read", "mailboxes:write", "mailboxes:create"]);
    expect(mailboxOnly).not.toContain("list_shared_mailbox_members");
    expect(mailboxOnly).not.toContain("add_shared_mailbox_member");
    expect(mailboxOnly).not.toContain("update_shared_mailbox_member");
    expect(mailboxOnly).not.toContain("create_shared_mailbox");
    const readable = namesFor(undefined, ["mailboxes:read", "mailboxes:write", "shared_mailboxes:read"]);
    expect(readable).toContain("list_shared_mailbox_members");
    expect(readable).not.toContain("update_shared_mailbox_member");
    const writable = namesFor(undefined, ["mailboxes:write", "shared_mailboxes:write"]);
    expect(writable).toContain("add_shared_mailbox_member");
    expect(writable).toContain("update_shared_mailbox_member");
    expect(writable).toContain("remove_shared_mailbox_member");
    expect(namesFor(undefined, ["shared_mailboxes:write"])).not.toContain("update_shared_mailbox_member");
  });
  it("preserves all 284 tools when TREKMAIL_TOOLSETS is omitted", () => {
    expect(namesFor()).toHaveLength(284);
  });

  it("exposes email tools plus minimal mailbox discovery", () => {
    const names = namesFor(["email"]);
    expect(names).toHaveLength(21);
    expect(names).toContain("list_messages");
    expect(names).toContain("send_message");
    expect(names).toContain("list_mailboxes");
    expect(names).not.toContain("list_domains");
    expect(names).not.toContain("list_contacts");
  });

  it("combines toolsets without duplicates", () => {
    const names = namesFor(["email", "contacts", "calendar"]);
    expect(names).toHaveLength(38);
    expect(names).toContain("list_contacts");
    expect(names).toContain("list_calendar_events");
  });

  it("intersects toolsets with granular token capabilities", () => {
    const names = namesFor(["domains"], ["domains:read", "domains:dns:read"]);
    expect(names).toContain("list_domains");
    expect(names).toContain("get_dns_requirements");
    expect(names).toContain("get_domain_connect_setup");
    expect(names).not.toContain("create_domain");
    expect(names).not.toContain("list_mailboxes");

    const withoutDns = namesFor(["domains"], ["domains:read"]);
    expect(withoutDns).not.toContain("get_domain_connect_setup");
  });

  it("loads White Label tools only for the matching live capabilities", () => {
    const none = namesFor(["white_label"], ["domains:read"]);
    expect(none).toEqual([]);

    const read = namesFor(
      ["white_label"],
      ["branding:read", "members:read", "activity:read"],
    );
    expect(read).toContain("get_white_label");
    expect(read).toContain("list_white_label_members");
    expect(read).toContain("get_white_label_member_activity");
    expect(read).not.toContain("invite_white_label_member");

    const activityOnly = namesFor(["white_label"], ["activity:read"]);
    expect(activityOnly).toContain("list_white_label_activity");
    expect(activityOnly).not.toContain("get_white_label_member_activity");
  });

  it("loads client storage limits by member scope and storage changes behind the destructive gate", () => {
    const read = namesFor(["white_label"], ["members:read"]);
    expect(read).toContain("list_client_limits");
    expect(read).not.toContain("set_client_limit");
    expect(read).not.toContain("remove_client_limit");

    const write = namesFor(["white_label"], ["members:read", "members:write"]);
    expect(write).toEqual(expect.arrayContaining([
      "list_client_limits", "set_client_limit", "remove_client_limit",
    ]));

    expect(namesFor(["mail_admin"], ["mailboxes:write"])).toContain("set_mailbox_storage");
    expect(namesFor(["mail_admin"], ["mailboxes:read"])).not.toContain("set_mailbox_storage");

    const gated = namesFor(
      ["white_label", "mail_admin"],
      ["members:read", "members:write", "mailboxes:write"],
      false,
      { destructive: false, sending: true, migration: true },
    );
    expect(gated).toContain("list_client_limits");
    expect(gated).not.toContain("set_client_limit");
    expect(gated).not.toContain("remove_client_limit");
    expect(gated).not.toContain("set_mailbox_storage");

    const readOnly = namesFor(["white_label", "mail_admin"], ["members:read", "members:write", "mailboxes:write"], true);
    expect(readOnly).toContain("list_client_limits");
    expect(readOnly).not.toContain("set_client_limit");
    expect(readOnly).not.toContain("set_mailbox_storage");
  });

  it("omits the tools the API refuses to a confined key, and only those", () => {
    const writer = ["members:read", "members:write", "mailboxes:read", "mailboxes:write"];
    const accountWide = ["update_account", "set_client_limit", "remove_client_limit"];
    const storage = (constraints?: ToolFilterOptions["constraints"]) =>
      namesFor(["white_label", "mail_admin"], writer, false, undefined, constraints)
        .filter((name) => [...accountWide, "list_client_limits", "set_mailbox_storage"].includes(name));

    // Unconfined, or constraints not discovered: everything the scopes allow.
    expect(storage({ domainIds: null, mailboxIds: null })).toEqual(expect.arrayContaining([...accountWide, "list_client_limits", "set_mailbox_storage"]));
    expect(storage(undefined)).toHaveLength(5);
    // Confined to some domains: the three account-wide writes go; the list
    // (its own limits) and per-mailbox storage stay.
    expect(storage({ domainIds: [7], mailboxIds: null }).sort()).toEqual(["list_client_limits", "set_mailbox_storage"]);
    // Confined to some mailboxes only: the API still lets it change a client
    // limit, but not the account-wide default for new mailboxes.
    expect(storage({ domainIds: null, mailboxIds: [9] }).sort())
      .toEqual(["list_client_limits", "remove_client_limit", "set_client_limit", "set_mailbox_storage"]);
    // Nothing else in the catalogue depends on confinement, except stopping
    // a folder share, which a mailbox-confined key never gets to do.
    expect(namesFor(undefined, undefined, false, undefined, { domainIds: [7], mailboxIds: [9] }))
      .toHaveLength(284 - accountWide.length - 1);
    expect(namesFor(undefined, undefined, false, undefined, { domainIds: [7], mailboxIds: [9] }))
      .not.toContain("drive_folder_stop_sharing");
    expect(namesFor(undefined, undefined, false, undefined, { domainIds: [7], mailboxIds: null }))
      .toContain("drive_folder_stop_sharing");
  });

  it("keeps message writes separate from permission to send", () => {
    const names = namesFor(["email"], ["messages:read", "messages:write"]);
    expect(names).toContain("move_message");
    expect(names).toContain("save_draft");
    expect(names).not.toContain("send_message");
  });

  it("supports a read-only profile without a separate connector", () => {
    const names = namesFor(
      ["email"],
      ["messages:read", "messages:write", "messages:send"],
      true,
    );
    expect(names).toContain("read_message");
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("delete_message");
  });

  it("does not advertise tools disabled by environment safety gates", () => {
    const names = namesFor(
      ["email", "email_settings"],
      ["messages:read", "messages:write", "messages:send"],
      false,
      { destructive: false, sending: false, migration: false },
    );
    expect(names).toContain("read_message");
    expect(names).not.toContain("send_message");
    expect(names).not.toContain("delete_message");
    expect(names).not.toContain("schedule_message");
  });

  it("projects canonical access and safety metadata into annotations", () => {
    const server = new McpServer({ name: "annotations", version: "1" });
    const filtered = withToolFilter(server, {
      transport: "stdio",
      safety: { destructive: true, sending: true, migration: true },
    });
    registerInfraTools(filtered, client, config);
    registerMessageTools(filtered, client, config);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools = (server as any)._registeredTools as Record<string, { annotations?: Record<string, boolean> }>;

    for (const entry of TOOL_CATALOG) {
      expect(tools[entry.name]?.annotations?.readOnlyHint, entry.name)
        .toBe(entry.access === "read");
      expect(tools[entry.name]?.annotations?.destructiveHint, entry.name)
        .toEqual(expect.any(Boolean));
      expect(tools[entry.name]?.annotations?.openWorldHint, entry.name)
        .toEqual(expect.any(Boolean));
    }
  });
});
