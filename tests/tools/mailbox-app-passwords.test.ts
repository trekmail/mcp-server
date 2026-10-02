import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TrekMailClient } from "../../src/client.js";
import { TOOL_CATALOG_BY_NAME, toolsForToolsets } from "../../src/tool-catalog.js";
import { withToolFilter } from "../../src/tool-filter.js";
import { registerMailboxAppPasswordTools } from "../../src/tools/mailbox-app-passwords.js";
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

  it("files the five tools with the mailbox admin tools, under the REST scopes the API checks", () => {
    const mailAdmin = toolsForToolsets(["mail_admin"]);
    const expected = {
      list_mailbox_app_passwords: ["mailboxes:read", "read"],
      create_mailbox_app_password: ["mailboxes:write", "write"],
      set_mailbox_client_auth_mode: ["mailboxes:write", "write"],
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

  it("change_mailbox_password sends revoke_app_passwords only when asked, and keys the two bodies apart", async () => {
    const { call } = harness(true);

    await call("change_mailbox_password", { mailbox_id: 7, password: "Correct-Horse-42" });
    const plain = lastRequest(mockFetch);
    await call("change_mailbox_password", { mailbox_id: 7, password: "Correct-Horse-42", revoke_app_passwords: true });
    const revoking = lastRequest(mockFetch);

    expect(plain.body).toEqual({ password: "Correct-Horse-42" });
    expect(revoking).toMatchObject({ path: "/api/v1/mailboxes/7/password", body: { password: "Correct-Horse-42", revoke_app_passwords: true } });
    // One key with two bodies is a 409 idempotency_mismatch from the API.
    expect(revoking.key).not.toBe(plain.key);
    expect(revoking.key).not.toContain("Correct-Horse-42");
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
