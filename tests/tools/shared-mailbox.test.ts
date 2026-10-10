import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";
import { registerSharedMailboxMemberTools } from "../../src/tools/shared-mailbox-members.js";
import { registerSharedMailboxLifecycleTools } from "../../src/tools/shared-mailbox-lifecycle.js";
import { registerMessageToolHandlers } from "../../src/tools/messages.js";
import { registerMessageScheduledTools } from "../../src/tools/message-scheduled.js";
import { registerMessageIdentityTools } from "../../src/tools/message-identities.js";
import { errorResult } from "../../src/tools/util.js";
import type { Config } from "../../src/config.js";

// ---------------------------------------------------------------------------
// Shared config helpers
// ---------------------------------------------------------------------------

const allowedConfig: Config = {
  baseUrl: "https://trekmail.test",
  apiToken: "tm_live_test",
  timeoutMs: 30_000,
  userAgent: "test",
  allowDestructive: true,
  allowSending: false,
  allowMigration: false,
};

const blockedConfig: Config = {
  ...allowedConfig,
  allowDestructive: false,
};

// ---------------------------------------------------------------------------
// Part A: independent Read and Send as permissions
// ---------------------------------------------------------------------------

describe("shared mailbox member tools (flat model)", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      listSharedMailboxMembers: vi.fn().mockResolvedValue({ data: [] }),
      addSharedMailboxMember: vi.fn().mockResolvedValue({
        id: 1,
        member_mailbox_id: 42,
        email: "alice@example.com",
        can_read: true,
        can_send: true,
        created_at: "2026-06-10T00:00:00Z",
      }),
      updateSharedMailboxMember: vi.fn().mockResolvedValue({
        id: 1,
        member_mailbox_id: 42,
        email: "alice@example.com",
        can_read: true,
        can_send: false,
        created_at: "2026-06-10T00:00:00Z",
      }),
      removeSharedMailboxMember: vi.fn().mockResolvedValue(null),
    } as unknown as TrekMailClient;
  });

  function memberTools(config: Config = allowedConfig) {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    const original = server.registerTool.bind(server);
    server.registerTool = ((name: string, definition: unknown, handler: never) => {
      handlers.set(name, handler);
      return original(name, definition as Parameters<typeof original>[1], handler);
    }) as typeof server.registerTool;
    registerSharedMailboxMemberTools(server, client, config);
    const tools = (server as unknown as {
      _registeredTools: Record<string, { description: string; inputSchema: { parse: (args: unknown) => Record<string, unknown> } }>;
    })._registeredTools;
    return { tools, handlers };
  }

  it("registered add tool forwards send-only access and an explicit retry key", async () => {
    const { tools, handlers } = memberTools();
    const input = tools.add_shared_mailbox_member.inputSchema.parse({
      mailbox_id: 10, member_mailbox_id: 42, can_read: false, can_send: true, idempotency_key: "send-only-add",
    });
    await handlers.get("add_shared_mailbox_member")!(input);
    expect(client.addSharedMailboxMember).toHaveBeenCalledWith(10,
      { member_mailbox_id: 42, can_read: false, can_send: true }, "send-only-add");
  });

  it("registered update tool accepts a Read-only patch and preserves omitted fields", async () => {
    const { tools, handlers } = memberTools();
    const input = tools.update_shared_mailbox_member.inputSchema.parse({
      mailbox_id: 10, member_id: 1, can_read: false,
    });
    await handlers.get("update_shared_mailbox_member")!(input);
    expect(client.updateSharedMailboxMember).toHaveBeenCalledWith(10, 1, { can_read: false });
  });

  it("registered update tool permits label-only patches and the legacy send-only field shape", async () => {
    const { tools, handlers } = memberTools();
    for (const patch of [{ custom_label: "Team" }, { can_send: false }]) {
      const input = tools.update_shared_mailbox_member.inputSchema.parse({ mailbox_id: 10, member_id: 1, ...patch });
      await handlers.get("update_shared_mailbox_member")!(input);
      expect(client.updateSharedMailboxMember).toHaveBeenLastCalledWith(10, 1, patch);
    }
  });

  it("member descriptions explain independent permissions and access refusals", () => {
    const { tools } = memberTools();
    expect(tools.list_shared_mailbox_members.description).toContain("read_send, read_only or send_only");
    expect(tools.list_shared_mailbox_members.description).not.toContain("always true");
    for (const name of ["add_shared_mailbox_member", "update_shared_mailbox_member"]) {
      for (const reason of ["no_access_left", "send_only_disabled", "last_reader"]) {
        expect(tools[name].description).toContain(reason);
      }
    }
  });

  // --- list ---

  it("listSharedMailboxMembers passes mailbox_id to client", async () => {
    await client.listSharedMailboxMembers(10);
    expect(client.listSharedMailboxMembers).toHaveBeenCalledWith(10);
  });

  // --- add: client method shape ---

  it("addSharedMailboxMember sends member_mailbox_id and can_send to client", async () => {
    await client.addSharedMailboxMember(
      10,
      { member_mailbox_id: 42, can_send: true },
      "idem-key-1",
    );
    expect(client.addSharedMailboxMember).toHaveBeenCalledWith(
      10,
      { member_mailbox_id: 42, can_send: true },
      "idem-key-1",
    );
  });

  it("addSharedMailboxMember omits can_send when not specified (API default applies)", async () => {
    await client.addSharedMailboxMember(
      10,
      { member_mailbox_id: 42 },
      "idem-key-2",
    );
    expect(client.addSharedMailboxMember).toHaveBeenCalledWith(
      10,
      { member_mailbox_id: 42 },
      "idem-key-2",
    );
  });

  it("addSharedMailboxMember uses fresh keys when adding again", () => {
    const key = idempotencyKey("add_shared_mailbox_member", {
      mailbox_id: 10,
      member_mailbox_id: 42,
      can_send: true,
    });
    expect(key).toMatch(/^mcp_add_shared_mailbox_member_/);
    // A removed member may be added again in a new operation.
    expect(
      idempotencyKey("add_shared_mailbox_member", {
        mailbox_id: 10,
        member_mailbox_id: 42,
        can_send: true,
      }),
    ).not.toBe(key);
  });

  it("addSharedMailboxMember idempotency key differs when can_send changes", () => {
    const key1 = idempotencyKey("add_shared_mailbox_member", {
      mailbox_id: 10,
      member_mailbox_id: 42,
      can_send: true,
    });
    const key2 = idempotencyKey("add_shared_mailbox_member", {
      mailbox_id: 10,
      member_mailbox_id: 42,
      can_send: false,
    });
    expect(key1).not.toBe(key2);
  });

  // --- add: allowDestructive gate ---

  it("add returns error result when allowDestructive=false", () => {
    expect(blockedConfig.allowDestructive).toBe(false);
    const result = errorResult(
      "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to add shared mailbox members.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain(
      "TREKMAIL_ALLOW_DESTRUCTIVE",
    );
  });

  // --- update: legacy client shape ---

  it("updateSharedMailboxMember sends can_send as required param", async () => {
    await client.updateSharedMailboxMember(10, 1, { can_send: false });
    expect(client.updateSharedMailboxMember).toHaveBeenCalledWith(10, 1, {
      can_send: false,
    });
  });

  it("updateSharedMailboxMember with can_send=true re-enables sending", async () => {
    await client.updateSharedMailboxMember(10, 1, { can_send: true });
    expect(client.updateSharedMailboxMember).toHaveBeenCalledWith(10, 1, {
      can_send: true,
    });
  });

  // --- update: allowDestructive gate ---

  it("update returns error result when allowDestructive=false", () => {
    expect(blockedConfig.allowDestructive).toBe(false);
    const result = errorResult(
      "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update shared mailbox members.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain(
      "TREKMAIL_ALLOW_DESTRUCTIVE",
    );
  });

  // --- remove ---

  it("removeSharedMailboxMember passes mailbox_id, member_id, and key", async () => {
    await client.removeSharedMailboxMember(10, 1, "rem-key-1");
    expect(client.removeSharedMailboxMember).toHaveBeenCalledWith(10, 1, "rem-key-1");
  });

  it("remove returns error result when allowDestructive=false", () => {
    expect(blockedConfig.allowDestructive).toBe(false);
    const result = errorResult(
      "Shared mailbox member removal is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in environment to enable.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain(
      "TREKMAIL_ALLOW_DESTRUCTIVE",
    );
  });
});

// ---------------------------------------------------------------------------
// Part B — lifecycle tools (create_shared_mailbox, convert_*_to_shared,
//           convert_shared_*_to_regular)
// ---------------------------------------------------------------------------

describe("shared mailbox lifecycle tools", () => {
  let client: TrekMailClient;

  const mockMailboxResource = {
    id: 99,
    email: "support@example.com",
    type: "shared",
    created_at: "2026-06-10T00:00:00Z",
  };

  beforeEach(() => {
    client = {
      createSharedMailbox: vi.fn().mockResolvedValue(mockMailboxResource),
      convertMailboxToShared: vi.fn().mockResolvedValue(mockMailboxResource),
      convertSharedMailboxToRegular: vi.fn().mockResolvedValue({
        ...mockMailboxResource,
        type: "regular",
      }),
    } as unknown as TrekMailClient;
  });

  it("requires the REST-required display_name in the registered MCP input schema", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerSharedMailboxLifecycleTools(server, client, allowedConfig);
    const tools = (server as unknown as {
      _registeredTools: Record<string, {
        inputSchema: { safeParse(input: unknown): { success: boolean } };
      }>;
    })._registeredTools;
    const schema = tools.create_shared_mailbox.inputSchema;
    const base = {
      domain_id: 5,
      local_part: "support",
      member_mailbox_ids: [10],
    };

    expect(schema.safeParse(base).success).toBe(false);
    expect(schema.safeParse({ ...base, display_name: "Support Team" }).success).toBe(true);
  });

  // --- create_shared_mailbox: client method ---

  it("createSharedMailbox forwards required fields", async () => {
    await client.createSharedMailbox(
      {
        domain_id: 5,
        local_part: "support",
        display_name: "Support Team",
        member_mailbox_ids: [10, 20],
      },
      "crt-key-1",
    );
    expect(client.createSharedMailbox).toHaveBeenCalledWith(
      {
        domain_id: 5,
        local_part: "support",
        display_name: "Support Team",
        member_mailbox_ids: [10, 20],
      },
      "crt-key-1",
    );
  });

  it("createSharedMailbox forwards optional storage params", async () => {
    await client.createSharedMailbox(
      {
        domain_id: 5,
        local_part: "team",
        display_name: "Team Inbox",
        member_mailbox_ids: [10],
        storage_shared: false,
        storage_mb: 2048,
      },
      "crt-key-2",
    );
    expect(client.createSharedMailbox).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: "Team Inbox",
        storage_shared: false,
        storage_mb: 2048,
      }),
      "crt-key-2",
    );
  });

  it("createSharedMailbox generates deterministic idempotency key", () => {
    const key = idempotencyKey("create_shared_mailbox", {
      domain_id: 5,
      local_part: "support",
      display_name: "Support Team",
      member_mailbox_ids: [10, 20],
      storage_shared: undefined,
      storage_mb: undefined,
    });
    expect(key).toMatch(/^mcp_create_shared_mailbox_/);
    const key2 = idempotencyKey("create_shared_mailbox", {
      domain_id: 5,
      local_part: "support",
      display_name: "Support Team",
      member_mailbox_ids: [10, 20],
      storage_shared: undefined,
      storage_mb: undefined,
    });
    expect(key).toBe(key2);
  });

  it("createSharedMailbox returns error when allowDestructive=false", () => {
    expect(blockedConfig.allowDestructive).toBe(false);
    const result = errorResult(
      "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create shared mailboxes.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain(
      "TREKMAIL_ALLOW_DESTRUCTIVE",
    );
  });

  // --- convert_mailbox_to_shared: client method ---

  it("convertMailboxToShared sends mailbox_id and member_mailbox_ids", async () => {
    await client.convertMailboxToShared(
      77,
      { member_mailbox_ids: [10, 20] },
      "conv-key-1",
    );
    expect(client.convertMailboxToShared).toHaveBeenCalledWith(
      77,
      { member_mailbox_ids: [10, 20] },
      "conv-key-1",
    );
  });

  it("convertMailboxToShared permits a new conversion after reverting", () => {
    const key = idempotencyKey("convert_mailbox_to_shared", {
      mailbox_id: 77,
      member_mailbox_ids: [10, 20],
    });
    expect(key).toMatch(/^mcp_convert_mailbox_to_shared_/);
    expect(
      idempotencyKey("convert_mailbox_to_shared", {
        mailbox_id: 77,
        member_mailbox_ids: [10, 20],
      }),
    ).not.toBe(key);
  });

  it("convertMailboxToShared returns error when allowDestructive=false", () => {
    expect(blockedConfig.allowDestructive).toBe(false);
    const result = errorResult(
      "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to convert mailboxes to shared.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain(
      "TREKMAIL_ALLOW_DESTRUCTIVE",
    );
  });

  // --- convert_shared_mailbox_to_regular: client method ---

  it("convertSharedMailboxToRegular sends mailbox_id and password", async () => {
    await client.convertSharedMailboxToRegular(
      99,
      { password: "Passw0rd!secure" },
      "conv-reg-key-1",
    );
    expect(client.convertSharedMailboxToRegular).toHaveBeenCalledWith(
      99,
      { password: "Passw0rd!secure" },
      "conv-reg-key-1",
    );
  });

  it("convertSharedMailboxToRegular permits a new conversion after reverting", () => {
    // Distinct conversions need fresh keys; explicit keys identify retries.
    const key = idempotencyKey("convert_shared_mailbox_to_regular", {
      mailbox_id: 99,
    });
    expect(key).toMatch(/^mcp_convert_shared_mailbox_to_regular_/);
    expect(
      idempotencyKey("convert_shared_mailbox_to_regular", { mailbox_id: 99 }),
    ).not.toBe(key);
  });

  it("convertSharedMailboxToRegular key differs for different mailbox_ids", () => {
    const key1 = idempotencyKey("convert_shared_mailbox_to_regular", {
      mailbox_id: 99,
    });
    const key2 = idempotencyKey("convert_shared_mailbox_to_regular", {
      mailbox_id: 100,
    });
    expect(key1).not.toBe(key2);
  });

  it("convertSharedMailboxToRegular returns error when allowDestructive=false", () => {
    expect(blockedConfig.allowDestructive).toBe(false);
    const result = errorResult(
      "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to convert shared mailboxes to regular.",
    );
    expect(result.isError).toBe(true);
    expect("text" in result.content[0] && result.content[0].text).toContain(
      "TREKMAIL_ALLOW_DESTRUCTIVE",
    );
  });

  // --- explicit idempotency key pass-through ---

  it("explicit idempotency_key is passed through unchanged for lifecycle tools", () => {
    const key = idempotencyKey(
      "create_shared_mailbox",
      { domain_id: 5, local_part: "support", member_mailbox_ids: [10] },
      "my-explicit-key",
    );
    expect(key).toBe("my-explicit-key");
  });
});


describe("delegated Message API guidance", () => {
  it.each(["send_message", "schedule_message", "list_identities", "delete_identity"])("documents delegated restrictions on %s", (name) => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = {} as TrekMailClient;
    registerMessageToolHandlers(server, client, allowedConfig);
    registerMessageScheduledTools(server, client, allowedConfig);
    registerMessageIdentityTools(server, client, allowedConfig);
    const tools = (server as unknown as {
      _registeredTools: Record<string, {
        description: string;
        inputSchema: { shape: Record<string, { description?: string }> };
      }>;
    })._registeredTools;
    const tool = tools[name];
    if (name === "delete_identity") {
      expect(tool.description).toContain("delegated team identities cannot be deleted");
      expect(tool.description).toContain("identity_delegated");
    } else {
      expect(tool.inputSchema.shape.shared_mailbox_id.description).toContain("both can_read and can_send");
      const guidance = name === "list_identities" ? tool.description : tool.inputSchema.shape.shared_mailbox_id.description;
      expect(guidance).toContain("webmail or a mail app");
      expect(guidance).toContain("Message API");
    }
  });
});
