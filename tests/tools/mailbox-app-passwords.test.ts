import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TrekMailClient } from "../../src/client.js";
import { TOOL_CATALOG_BY_NAME, toolsForToolsets } from "../../src/tool-catalog.js";
import { withToolFilter } from "../../src/tool-filter.js";
import { registerMailboxAppPasswordTools } from "../../src/tools/mailbox-app-passwords.js";
import { registerAccountTools } from "../../src/tools/account.js";
import { registerMailboxTools } from "../../src/tools/mailboxes.js";
import { registerMailClientSetupTools } from "../../src/tools/mail-client-setup.js";
import { createMockFetch, getLastFetchCall, mockFetchResponse } from "../helpers/mock-fetch.js";

/**
 * The app-password tools against the real client and a stubbed fetch, so each
 * test pins the REST call the tool makes (verb, path, body, Idempotency-Key)
 * rather than a mock of the client method it happens to call.
 */
type Tool = {
  definition: { description: string; inputSchema: z.ZodRawShape; annotations?: Record<string, unknown> };
  handler: (input: Record<string, unknown>) => Promise<CallToolResult>;
};

function harness(allowDestructive: boolean, filtered = false) {
  const tools = new Map<string, Tool>();
  const recorder = {
    registerTool(name: string, definition: Tool["definition"], handler: Tool["handler"]) {
      tools.set(name, { definition, handler });
    },
  } as unknown as McpServer;
  // With `filtered`, register through withToolFilter as src/index.ts does, so
  // the recorded annotations are the ones a client actually sees.
  const server = filtered
    ? withToolFilter(recorder, { transport: "stdio", safety: { destructive: true, sending: true, migration: true } })
    : recorder;
  const client = new TrekMailClient({
    baseUrl: "https://trekmail.test",
    token: "tm_live_test",
    timeoutMs: 30_000,
    userAgent: "test",
  });
  registerMailboxAppPasswordTools(server, client, { allowDestructive });
  registerMailboxTools(server, client, { allowDestructive });
  registerMailClientSetupTools(server, client);
  registerAccountTools(server, client, { allowDestructive });

  const call = async (name: string, input: Record<string, unknown>) => {
    const tool = tools.get(name)!;
    return tool.handler(z.object(tool.definition.inputSchema).parse(input));
  };
  return { tools, call };
}

function lastRequest(mockFetch: ReturnType<typeof createMockFetch>) {
  const { url, init } = getLastFetchCall(mockFetch);
  const headers = init.headers as Record<string, string>;
  return {
    method: init.method,
    path: new URL(url).pathname,
    body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    key: headers["Idempotency-Key"],
  };
}

describe("mailbox app password tools", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch({ status: 200, body: { data: {} } });
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists a mailbox's app passwords with a plain GET", async () => {
    const { call } = harness(false);
    mockFetchResponse(mockFetch, {
      body: { mailbox_id: 7, client_auth_mode: "app_password_only", limit: 25, active_count: 1, data: [{ id: 3, name: "iPhone", active: true }] },
    });

    const result = await call("list_mailbox_app_passwords", { mailbox_id: 7 });

    expect(result.isError).toBeUndefined();
    expect(lastRequest(mockFetch)).toEqual({ method: "GET", path: "/api/v1/mailboxes/7/app-passwords", body: undefined, key: undefined });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ client_auth_mode: "app_password_only", active_count: 1 });
  });

  it("creates one with the name only, and returns the one-time password to the agent", async () => {
    const { call } = harness(true);
    mockFetchResponse(mockFetch, {
      status: 201,
      body: { data: { id: 3, name: "Outlook", password: "abcdefghijklmnop" }, message: "Shown once." },
    });

    const result = await call("create_mailbox_app_password", { mailbox_id: 7, name: "Outlook" });

    const request = lastRequest(mockFetch);
    expect(request).toMatchObject({ method: "POST", path: "/api/v1/mailboxes/7/app-passwords", body: { name: "Outlook" } });
    expect(request.key).toMatch(/^mcp_create_mailbox_app_password_/);
    expect((result.content[0] as { text: string }).text).toContain("abcdefghijklmnop");
  });

  it("gives every create call its own key, so a deliberate second create mints a password instead of replaying one stripped of it", async () => {
    const { call } = harness(true);

    await call("create_mailbox_app_password", { mailbox_id: 7, name: "iPhone" });
    const first = lastRequest(mockFetch).key;
    await call("create_mailbox_app_password", { mailbox_id: 7, name: "iPhone" });
    const second = lastRequest(mockFetch).key;
    await call("create_mailbox_app_password", { mailbox_id: 7, name: "iPhone", idempotency_key: "retry-me" });

    expect(first).not.toBe(second);
    expect(lastRequest(mockFetch).key).toBe("retry-me");
  });

  it("rotates and revokes by row id, each with a key derived from that row", async () => {
    const { call } = harness(true);

    await call("rotate_mailbox_app_password", { mailbox_id: 7, app_password_id: 3 });
    const rotate = lastRequest(mockFetch);
    expect(rotate).toMatchObject({ method: "POST", path: "/api/v1/mailboxes/7/app-passwords/3:rotate", body: undefined });
    await call("rotate_mailbox_app_password", { mailbox_id: 7, app_password_id: 3 });
    expect(lastRequest(mockFetch).key).toBe(rotate.key);

    await call("revoke_mailbox_app_password", { mailbox_id: 7, app_password_id: 3 });
    const revoke = lastRequest(mockFetch);
    expect(revoke).toMatchObject({ method: "DELETE", path: "/api/v1/mailboxes/7/app-passwords/3", body: undefined });
    expect(revoke.key).toMatch(/^mcp_revoke_mailbox_app_password_/);
    expect(revoke.key).not.toBe(rotate.key);
  });

  it("sets the mode under the API's `mode` field, with a fresh key per call", async () => {
    const { call } = harness(true);

    await call("set_mailbox_client_auth_mode", { mailbox_id: 7, client_auth_mode: "app_password_only" });
    const tighten = lastRequest(mockFetch);
    await call("set_mailbox_client_auth_mode", { mailbox_id: 7, client_auth_mode: "password_or_app_password" });
    await call("set_mailbox_client_auth_mode", { mailbox_id: 7, client_auth_mode: "app_password_only" });
    const again = lastRequest(mockFetch);

    expect(tighten).toMatchObject({ method: "POST", path: "/api/v1/mailboxes/7:client-auth-mode", body: { mode: "app_password_only" } });
    // Tighten, loosen, tighten: a key derived from the arguments would replay
    // the first answer for the third call and leave the mailbox loose.
    expect(again.key).not.toBe(tighten.key);
  });

  it.each([{ mailbox_ids: [7, 8] }, { domain_id: 5 }, { all: true }])("sends bulk selector %j to the bulk route", async (selector) => {
    const { call } = harness(true);
    const resultBody = { data: { client_auth_mode: "app_password_only", matched: 2, updated: 1, skipped: 1 } };
    mockFetchResponse(mockFetch, { body: resultBody });
    const result = await call("set_mailbox_client_auth_mode", { ...selector, client_auth_mode: "app_password_only", idempotency_key: "bulk-7" });
    expect(lastRequest(mockFetch)).toEqual({ method: "POST", path: "/api/v1/mailboxes:client-auth-mode", body: { mode: "app_password_only", ...selector }, key: "bulk-7" });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(resultBody);
  });

  it.each([{}, { all: false }, { mailbox_id: 7, mailbox_ids: [8] }, { mailbox_id: 7, domain_id: 5 }, { mailbox_id: 7, all: true }, { mailbox_ids: [7], domain_id: 5 }, { domain_id: 5, all: true }, { mailbox_ids: [7], all: true }])("rejects conflicting or absent selectors %j without an API call", async (selector) => {
    const { call } = harness(true);
    const result = await call("set_mailbox_client_auth_mode", { ...selector, client_auth_mode: "app_password_only" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("Choose exactly one");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("ignores all:false with a valid selector and reuses only explicit retry keys", async () => {
    const { call } = harness(true);
    const input = { domain_id: 5, all: false, client_auth_mode: "app_password_only" };
    await call("set_mailbox_client_auth_mode", input);
    const first = lastRequest(mockFetch);
    await call("set_mailbox_client_auth_mode", { ...input, client_auth_mode: "password_or_app_password" });
    await call("set_mailbox_client_auth_mode", input);
    expect(lastRequest(mockFetch).key).not.toBe(first.key);
    expect(first.body).toEqual({ mode: "app_password_only", domain_id: 5 });
    await call("set_mailbox_client_auth_mode", { ...input, idempotency_key: "retry" });
    await call("set_mailbox_client_auth_mode", { ...input, idempotency_key: "retry" });
    expect(lastRequest(mockFetch).key).toBe("retry");
  });

  it.each([[], [0], [1.5], Array.from({ length: 1001 }, (_, i) => i + 1)].map((mailbox_ids) => ({ mailbox_ids })))("rejects an invalid ID list before calling the API", async ({ mailbox_ids }) => {
    const { call } = harness(true);
    await expect(call("set_mailbox_client_auth_mode", { mailbox_ids, client_auth_mode: "app_password_only" })).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses the same selector Zod shapes as set_mailboxes_login_access", () => {
    const { tools } = harness(true);
    const bulk = tools.get("set_mailbox_client_auth_mode")!.definition.inputSchema;
    const login = tools.get("set_mailboxes_login_access")!.definition.inputSchema;
    for (const name of ["mailbox_ids", "domain_id", "all"]) {
      for (const value of [undefined, [], [1], [0], [1.5], Array(1000).fill(1), Array(1001).fill(1), 1, 0, 1.5, true, false, "1"]) {
        expect(bulk[name].safeParse(value).success).toBe(login[name].safeParse(value).success);
      }
    }
  });

  it.each([404, 403, 422])("preserves an upstream bulk or account refusal at %i", async (status) => {
    const { call } = harness(true);
    const code = status === 404 ? "not_found" : status === 403 ? "scope_blocked_by_membership" : "selection_too_large";
    for (const [name, input] of [["set_mailbox_client_auth_mode", { all: true, client_auth_mode: "app_password_only" }], ["update_account", { new_mailbox_client_auth_mode: "app_password_only" }]] as const) {
      mockFetchResponse(mockFetch, { status, body: { error: { code, message: "Refused" } } });
      const result = await call(name, input);
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain(code);
    }
  });

  it("writes only the account default via PATCH, with fresh operations and explicit retries", async () => {
    const { call, tools } = harness(true);
    const input = { new_mailbox_client_auth_mode: "app_password_only" };
    await call("update_account", input);
    const first = lastRequest(mockFetch);
    await call("update_account", { new_mailbox_client_auth_mode: "password_or_app_password" });
    await call("update_account", input);
    expect(lastRequest(mockFetch)).toMatchObject({ method: "PATCH", path: "/api/v1/account", body: input });
    expect(lastRequest(mockFetch).key).not.toBe(first.key);
    await call("update_account", { ...input, idempotency_key: "account-retry" });
    expect(lastRequest(mockFetch).key).toBe("account-retry");
    expect(tools.get("get_account")!.definition.description).toContain("new_mailbox_client_auth_mode");
    expect(tools.get("update_account")!.definition.description).toContain("owner");
  });

  it.each(["app_password", "", null])("rejects an unknown account default %j", async (new_mailbox_client_auth_mode) => {
    const { call } = harness(true);
    await expect(call("update_account", { new_mailbox_client_auth_mode })).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a mode the API does not know before calling it", async () => {
    const { call } = harness(true);
    await expect(call("set_mailbox_client_auth_mode", { mailbox_id: 7, client_auth_mode: "app_password" })).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["create_mailbox_app_password", { mailbox_id: 7, name: "iPhone" }],
    ["rotate_mailbox_app_password", { mailbox_id: 7, app_password_id: 3 }],
    ["revoke_mailbox_app_password", { mailbox_id: 7, app_password_id: 3 }],
    ["set_mailbox_client_auth_mode", { mailbox_id: 7, client_auth_mode: "app_password_only" }],
    ["set_mailbox_client_auth_mode", { all: true, client_auth_mode: "app_password_only" }],
    ["update_account", { new_mailbox_client_auth_mode: "app_password_only" }],
  ])("%s stays behind TREKMAIL_ALLOW_DESTRUCTIVE", async (name, input) => {
    const { call } = harness(false);
    const result = await call(name, input);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("TREKMAIL_ALLOW_DESTRUCTIVE=true");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("tells the agent to hand over the secret once and never keep it", () => {
    const { tools } = harness(true);
    for (const name of ["create_mailbox_app_password", "rotate_mailbox_app_password"]) {
      const description = tools.get(name)!.definition.description;
      expect(description, name).toContain("cannot be shown again");
      expect(description, name).toContain("Do not store it");
    }
  });

  it("files app-password and account-default tools with the mailbox admin tools, under the REST scopes the API checks", () => {
    const mailAdmin = toolsForToolsets(["mail_admin"]);
    const expected = {
      list_mailbox_app_passwords: ["mailboxes:read", "read"],
      create_mailbox_app_password: ["mailboxes:write", "write"],
      set_mailbox_client_auth_mode: ["mailboxes:write", "write"],
      update_account: ["mailboxes:write", "write"],
      rotate_mailbox_app_password: ["mailboxes:write", "destructive"],
      revoke_mailbox_app_password: ["mailboxes:write", "destructive"],
    } as const;

    for (const [name, [capability, access]] of Object.entries(expected)) {
      const entry = TOOL_CATALOG_BY_NAME.get(name)!;
      expect(mailAdmin.has(name), name).toBe(true);
      expect(entry.anyOfCapabilities, name).toEqual([capability]);
      expect(entry.access, name).toBe(access);
      expect(entry.transports, name).toEqual(["stdio", "http"]);
      expect(entry.safetyGate, name).toBe(access === "read" ? undefined : "destructive");
    }

    // The hint a client sees, as withToolFilter projects it from the catalog.
    // Minting a credential asks for confirmation like drive_device_create;
    // replacing, revoking and tightening the mode cut off a running mail app.
    const { tools } = harness(true, true);
    const hint = (name: string) => tools.get(name)!.definition.annotations?.destructiveHint;
    expect(hint("list_mailbox_app_passwords")).toBe(false);
    expect(hint("create_mailbox_app_password")).toBe(true);
    expect(hint("rotate_mailbox_app_password")).toBe(true);
    expect(hint("revoke_mailbox_app_password")).toBe(true);
    expect(hint("set_mailbox_client_auth_mode")).toBe(true);
    expect(hint("update_account")).toBe(true);
  });
});

describe("existing mailbox tools and app passwords", () => {
  let mockFetch: ReturnType<typeof createMockFetch>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mockFetch = createMockFetch({ status: 200, body: { data: {} } });
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each([200, 202])("password resets send only password and preserve the revocation count at %i", async (status) => {
    const { tools, call } = harness(true);
    expect(tools.get("change_mailbox_password")!.definition.inputSchema).not.toHaveProperty("revoke_app_passwords");
    mockFetchResponse(mockFetch, { status, body: { app_passwords_revoked: 3, sync_pending: status === 202 } });
    const result = await call("change_mailbox_password", { mailbox_id: 7, password: "Correct-Horse-42", idempotency_key: "reset-7" });
    expect(lastRequest(mockFetch)).toEqual({ method: "POST", path: "/api/v1/mailboxes/7/password", body: { password: "Correct-Horse-42" }, key: "reset-7" });
    expect(JSON.parse((result.content[0] as { text: string }).text).app_passwords_revoked).toBe(3);
    for (const name of ["change_mailbox_password", "create_mailbox_generated_password"]) {
      expect(tools.get(name)!.definition.description).toMatch(/app passwords are enabled.*automatically revokes.*mailbox_password_reset/s);
    }
  });

  it("does not invent a revocation count when the feature is off", async () => {
    const { call } = harness(true);
    mockFetchResponse(mockFetch, { body: { status: "updated", sync_pending: false } });
    const result = await call("change_mailbox_password", { mailbox_id: 7, password: "Correct-Horse-42" });
    expect(JSON.parse((result.content[0] as { text: string }).text)).not.toHaveProperty("app_passwords_revoked");
  });

  it("create_mailbox_generated_password passes client_auth_mode through, and leaves calls without it unchanged", async () => {
    const { call } = harness(true);

    await call("create_mailbox_generated_password", { domain_id: 5, local_part: "alice" });
    const plain = lastRequest(mockFetch);
    await call("create_mailbox_generated_password", { domain_id: 5, local_part: "alice", client_auth_mode: "password_or_app_password" });
    const explicit = lastRequest(mockFetch);

    expect(plain.body).toEqual({ domain_id: 5, local_part: "alice", password_mode: "generated_one_time" });
    expect(explicit.body).toEqual({ domain_id: 5, local_part: "alice", client_auth_mode: "password_or_app_password", password_mode: "generated_one_time" });
    expect(explicit.key).not.toBe(plain.key);
  });

  it("points the agent from a webmail-only generated password to create_mailbox_app_password", () => {
    const { tools } = harness(true);
    expect(tools.get("create_mailbox_generated_password")!.definition.description)
      .toMatch(/app_password_only.*webmail only.*create_mailbox_app_password/s);
    expect(tools.get("get_mail_client_setup")!.definition.description)
      .toMatch(/password_source.*accepted_passwords.*create_mailbox_app_password/s);
    for (const name of ["get_mailbox", "list_mailboxes"]) {
      expect(tools.get(name)!.definition.description, name).toContain("client_auth_mode");
      expect(tools.get(name)!.definition.description, name).toContain("app_passwords_count");
    }
  });

  it("does not tell the agent that every webmail ignores the mode (classic webmail signs in like a mail app)", () => {
    // Classic webmail (Roundcube) signs in over IMAP like any mail app, so on
    // an app_password_only mailbox it takes an app password. A text that says
    // only "webmail always takes the mailbox password" would have the agent
    // tell a classic-webmail user that tightening changes nothing for them.
    const { tools } = harness(true);
    for (const name of [
      "get_mailbox",
      "list_mailbox_app_passwords",
      "create_mailbox_app_password",
      "set_mailbox_client_auth_mode",
      "create_mailbox_generated_password",
    ]) {
      const description = tools.get(name)!.definition.description;
      expect(description, name).toContain("classic webmail");
      expect(description, name).not.toMatch(/(^|[.;:] )Webmail always/);
    }
  });

  it("says what suspension and resumption do to app passwords", () => {
    const { tools } = harness(true);
    expect(tools.get("suspend_mailbox_login")!.definition.description).toContain("app password");
    expect(tools.get("set_mailboxes_login_access")!.definition.description).toContain("app passwords");
    expect(tools.get("resume_mailbox_login")!.definition.description)
      .toMatch(/App passwords .*not restored.*create_mailbox_app_password/s);
  });
});
