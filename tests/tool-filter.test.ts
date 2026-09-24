import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import type { TrekMailClient } from "../src/client.js";
import { withToolFilter } from "../src/tool-filter.js";
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
): string[] {
  const server = new McpServer({ name: "test", version: "1" });
  const filtered = withToolFilter(server, {
    transport: "stdio",
    toolsets,
    capabilities,
    readOnly,
    safety,
  });
  registerInfraTools(filtered, client, config);
  registerMessageTools(filtered, client, config);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.keys((server as any)._registeredTools as Record<string, unknown>);
}

describe("stdio toolset filtering", () => {
  it("preserves all 264 tools when TREKMAIL_TOOLSETS is omitted", () => {
    expect(namesFor()).toHaveLength(264);
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
    expect(names).not.toContain("create_domain");
    expect(names).not.toContain("list_mailboxes");
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
        .toBe(entry.safetyGate === "destructive");
    }
  });
});
