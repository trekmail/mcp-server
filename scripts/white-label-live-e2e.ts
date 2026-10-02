/**
 * Live customer-style White Label acceptance client.
 *
 * This intentionally talks to running Laravel and Streamable HTTP MCP servers
 * and launches the built stdio MCP server. A caller supplies isolated fixture
 * IDs and credentials through the WL_E2E_* environment variables below. The
 * script prints only a bounded result summary; bearer tokens are never logged.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const WHITE_LABEL_TOOLS = [
  "get_white_label",
  "get_white_label_access_catalog",
  "list_white_label_members",
  "get_white_label_member",
  "invite_white_label_member",
  "update_white_label_member",
  "suspend_white_label_member",
  "resume_white_label_member",
  "resend_white_label_invitation",
  "remove_white_label_member",
  "restore_white_label_member",
  "list_white_label_activity",
  "get_white_label_member_activity",
  "get_domain_branding",
  "set_domain_branding",
  "set_domain_brand_logo",
  "verify_domain_branding_dns",
  "create_branding_preview",
  "remove_domain_brand_logo",
  "remove_domain_branding",
] as const;

const MUTATING_TOOLS = [
  "invite_white_label_member",
  "update_white_label_member",
  "suspend_white_label_member",
  "resume_white_label_member",
  "resend_white_label_invitation",
  "remove_white_label_member",
  "restore_white_label_member",
  "set_domain_branding",
  "set_domain_brand_logo",
  "verify_domain_branding_dns",
  "create_branding_preview",
  "remove_domain_brand_logo",
  "remove_domain_branding",
] as const;

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveId(name: string): number {
  const value = Number(env(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const baseUrl = env("WL_E2E_BASE_URL").replace(/\/+$/, "");
const mcpUrl = env("WL_E2E_MCP_URL");
const stamp = env("WL_E2E_STAMP");
const restToken = env("WL_E2E_REST_TOKEN");
const stdioToken = env("WL_E2E_STDIO_TOKEN");
const noScopeToken = env("WL_E2E_NO_SCOPE_TOKEN");
const constrainedToken = env("WL_E2E_CONSTRAINED_TOKEN");
const inactiveToken = env("WL_E2E_INACTIVE_TOKEN");
const oauthToken = env("WL_E2E_OAUTH_TOKEN");
const noScopeOauthToken = env("WL_E2E_NO_SCOPE_OAUTH_TOKEN");
const inactiveOauthToken = env("WL_E2E_INACTIVE_OAUTH_TOKEN");
const wrongAudienceOauthToken = env("WL_E2E_WRONG_AUDIENCE_OAUTH_TOKEN");
const restDomainId = positiveId("WL_E2E_REST_DOMAIN_ID");
const stdioDomainId = positiveId("WL_E2E_STDIO_DOMAIN_ID");
const httpDomainId = positiveId("WL_E2E_HTTP_DOMAIN_ID");
const inactiveDomainId = positiveId("WL_E2E_INACTIVE_DOMAIN_ID");
const foreignMembershipId = positiveId("WL_E2E_FOREIGN_MEMBERSHIP_ID");

type Json = Record<string, unknown>;
type ApiSpec = {
  name: string;
  method: string;
  path: string;
  body?: Json;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function api(
  token: string | null,
  method: string,
  path: string,
  options: { body?: Json; idempotencyKey?: string; expected: number | number[] } = { expected: 200 },
): Promise<{ body: Json; response: Response }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  const response = await fetch(`${baseUrl}/api/v1${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body: Json = {};
  if (text !== "") {
    try {
      body = JSON.parse(text) as Json;
    } catch {
      throw new Error(`${method} ${path} returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
    }
  }

  const expectedStatuses = Array.isArray(options.expected) ? options.expected : [options.expected];
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${method} ${path}: expected ${expectedStatuses.join(" or ")}, received ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return { body, response };
}

function assertActionableError(body: Json, expectedCode?: string): void {
  const error = body.error as Json | undefined;
  assert(error && typeof error === "object", `Missing API error envelope: ${JSON.stringify(body)}`);
  if (expectedCode) {
    assert(error.code === expectedCode, `Expected ${expectedCode}, received ${String(error.code)}`);
  }
  assert(typeof error.message === "string" && error.message.length > 0, "Error message is missing");
  assert(typeof error.hint === "string" && error.hint.length > 0, "Actionable error hint is missing");
  assert(typeof error.request_id === "string" && error.request_id.length > 0, "request_id is missing");
  assert(typeof error.retryable === "boolean", "retryable flag is missing");
}

async function runRestMatrix(): Promise<Record<string, unknown>> {
  const successes: string[] = [];
  const success = async (
    name: string,
    method: string,
    path: string,
    options: { body?: Json; idempotencyKey?: string; expected?: number } = {},
  ): Promise<{ body: Json; response: Response }> => {
    const result = await api(restToken, method, path, {
      ...options,
      expected: options.expected ?? 200,
    });
    successes.push(name);
    return result;
  };

  const overview = await success("get_white_label", "GET", "/white-label");
  assert((overview.body.entitlement as Json)?.state === "active", "REST overview did not report active");
  await success("get_white_label_access_catalog", "GET", "/white-label/access-catalog");
  await success("list_white_label_members", "GET", "/white-label/members");

  const brandingBody = {
    mode: "custom",
    name: `REST Live ${stamp}`,
    primary_color: "#123456",
    accent_color: "#abcdef",
    dashboard_enabled: true,
    dashboard_label: "portal",
    webmail_enabled: true,
    webmail_label: "mail",
    mail_zone_enabled: false,
    support_email: `support-${stamp}@example.test`,
    support_url: "https://support.example.test/help",
    scope: "domain",
  };
  const branded = await success(
    "set_domain_branding",
    "PATCH",
    `/domains/${restDomainId}/branding`,
    { body: brandingBody, idempotencyKey: `rest-brand-${stamp}` },
  );
  assert((branded.body.data as Json)?.mode === "custom", "REST branding update was not applied");
  const branding = await success("get_domain_branding", "GET", `/domains/${restDomainId}/branding`);
  assert((branding.body.data as Json)?.mode === "custom", "REST branding readback was wrong");

  const badLogo = await api(restToken, "PUT", `/domains/${restDomainId}/branding/logo/light`, {
    body: { content_base64: "not-base64", scope: "domain" },
    idempotencyKey: `rest-logo-bad-${stamp}`,
    expected: 422,
  });
  assertActionableError(badLogo.body, "invalid_base64");

  const logo = await success(
    "set_domain_brand_logo",
    "PUT",
    `/domains/${restDomainId}/branding/logo/light`,
    {
      body: { content_base64: PNG_1X1, scope: "domain" },
      idempotencyKey: `rest-logo-set-${stamp}`,
    },
  );
  assert(typeof ((logo.body.data as Json)?.brand as Json)?.logo_url === "string", "REST logo URL missing");
  await success(
    "remove_domain_brand_logo",
    "DELETE",
    `/domains/${restDomainId}/branding/logo/light`,
    { body: { scope: "domain" }, idempotencyKey: `rest-logo-remove-${stamp}` },
  );
  const dns = await success(
    "verify_domain_branding_dns",
    "POST",
    `/domains/${restDomainId}/branding/verify-dns`,
    { body: {}, idempotencyKey: `rest-dns-${stamp}` },
  );
  assert((dns.body.data as Json)?.status === "queued", "REST DNS verification was not queued");
  const preview = await success(
    "create_branding_preview",
    "POST",
    `/domains/${restDomainId}/branding/preview`,
    { body: {}, idempotencyKey: `rest-preview-${stamp}` },
  );
  assert(typeof (preview.body.data as Json)?.url === "string", "REST preview URL missing");

  const invitePayload = {
    email: `rest-client-${stamp}@example.test`,
    role: "client",
    all_domains: false,
    domain_ids: [restDomainId],
    note: "REST live invitation",
  };
  const inviteKey = `rest-invite-${stamp}`;
  const invited = await success("invite_white_label_member", "POST", "/white-label/members", {
    body: invitePayload,
    idempotencyKey: inviteKey,
    expected: 201,
  });
  const memberId = Number(invited.body.id);
  assert(Number.isInteger(memberId) && memberId > 0, "REST invitation returned no member id");
  assert(invited.body.note === "REST live invitation", "REST invitation note was not persisted");

  const replay = await api(restToken, "POST", "/white-label/members", {
    body: invitePayload,
    idempotencyKey: inviteKey,
    expected: 201,
  });
  assert(replay.response.headers.get("x-idempotency-replayed") === "true", "REST replay header missing");
  assert(
    String((replay.body.invitation as Json)?.url).includes("<redacted>"),
    "REST replay exposed the one-time invitation token",
  );
  const mismatch = await api(restToken, "POST", "/white-label/members", {
    body: { ...invitePayload, email: `mismatch-${stamp}@example.test` },
    idempotencyKey: inviteKey,
    expected: 409,
  });
  assertActionableError(mismatch.body, "idempotency_mismatch");

  await success("get_white_label_member", "GET", `/white-label/members/${memberId}`);
  const updated = await success("update_white_label_member", "PATCH", `/white-label/members/${memberId}`, {
    body: { note: "REST live updated" },
    idempotencyKey: `rest-member-update-${stamp}`,
  });
  assert(updated.body.note === "REST live updated", "REST member update readback failed");
  await success("suspend_white_label_member", "POST", `/white-label/members/${memberId}:suspend`, {
    body: {},
    idempotencyKey: `rest-member-suspend-${stamp}`,
  });
  const invalidTransition = await api(
    restToken,
    "POST",
    `/white-label/members/${memberId}:suspend`,
    { body: {}, idempotencyKey: `rest-member-suspend-again-${stamp}`, expected: 409 },
  );
  assertActionableError(invalidTransition.body, "membership_state_conflict");
  await success("resume_white_label_member", "POST", `/white-label/members/${memberId}:resume`, {
    body: {},
    idempotencyKey: `rest-member-resume-${stamp}`,
  });
  await success(
    "resend_white_label_invitation",
    "POST",
    `/white-label/members/${memberId}:resend-invitation`,
    { body: {}, idempotencyKey: `rest-member-resend-${stamp}` },
  );
  await success("list_white_label_activity", "GET", "/white-label/activity");
  await success(
    "get_white_label_member_activity",
    "GET",
    `/white-label/members/${memberId}/activity?limit=10`,
  );
  await success("remove_white_label_member", "DELETE", `/white-label/members/${memberId}`, {
    body: {},
    idempotencyKey: `rest-member-remove-${stamp}`,
  });
  await success("restore_white_label_member", "POST", `/white-label/members/${memberId}:restore`, {
    body: {},
    idempotencyKey: `rest-member-restore-${stamp}`,
  });
  await success("remove_domain_branding", "DELETE", `/domains/${restDomainId}/branding?scope=domain`, {
    body: {},
    idempotencyKey: `rest-brand-remove-${stamp}`,
  });

  assert(new Set(successes).size === WHITE_LABEL_TOOLS.length, `REST success matrix covered ${new Set(successes).size}/20`);
  for (const operation of WHITE_LABEL_TOOLS) {
    assert(successes.includes(operation), `REST success matrix missed ${operation}`);
  }

  const failureSpecs: ApiSpec[] = [
    { name: "get_white_label", method: "GET", path: "/white-label" },
    { name: "get_white_label_access_catalog", method: "GET", path: "/white-label/access-catalog" },
    { name: "list_white_label_members", method: "GET", path: "/white-label/members" },
    { name: "get_white_label_member", method: "GET", path: `/white-label/members/${memberId}` },
    { name: "invite_white_label_member", method: "POST", path: "/white-label/members", body: invitePayload },
    { name: "update_white_label_member", method: "PATCH", path: `/white-label/members/${memberId}`, body: { note: "denied" } },
    { name: "suspend_white_label_member", method: "POST", path: `/white-label/members/${memberId}:suspend`, body: {} },
    { name: "resume_white_label_member", method: "POST", path: `/white-label/members/${memberId}:resume`, body: {} },
    { name: "resend_white_label_invitation", method: "POST", path: `/white-label/members/${memberId}:resend-invitation`, body: {} },
    { name: "remove_white_label_member", method: "DELETE", path: `/white-label/members/${memberId}`, body: {} },
    { name: "restore_white_label_member", method: "POST", path: `/white-label/members/${memberId}:restore`, body: {} },
    { name: "list_white_label_activity", method: "GET", path: "/white-label/activity" },
    { name: "get_white_label_member_activity", method: "GET", path: `/white-label/members/${memberId}/activity` },
    { name: "get_domain_branding", method: "GET", path: `/domains/${restDomainId}/branding` },
    { name: "set_domain_branding", method: "PATCH", path: `/domains/${restDomainId}/branding`, body: brandingBody },
    { name: "set_domain_brand_logo", method: "PUT", path: `/domains/${restDomainId}/branding/logo/light`, body: { content_base64: PNG_1X1 } },
    { name: "verify_domain_branding_dns", method: "POST", path: `/domains/${restDomainId}/branding/verify-dns`, body: {} },
    { name: "create_branding_preview", method: "POST", path: `/domains/${restDomainId}/branding/preview`, body: {} },
    { name: "remove_domain_brand_logo", method: "DELETE", path: `/domains/${restDomainId}/branding/logo/light`, body: {} },
    { name: "remove_domain_branding", method: "DELETE", path: `/domains/${restDomainId}/branding`, body: {} },
  ];
  for (const [index, spec] of failureSpecs.entries()) {
    const denied = await api(noScopeToken, spec.method, spec.path, {
      body: spec.body,
      idempotencyKey: spec.body === undefined ? undefined : `denied-${index}-${stamp}`,
      expected: 403,
    });
    assertActionableError(denied.body, "insufficient_scope");
  }

  const unauthenticated = await api(null, "GET", "/white-label", { expected: 401 });
  assertActionableError(unauthenticated.body, "unauthenticated");
  const inactiveRead = await api(inactiveToken, "GET", "/white-label", { expected: 403 });
  assertActionableError(inactiveRead.body, "scope_blocked_by_entitlement");
  const inactiveWrite = await api(inactiveToken, "PATCH", `/domains/${inactiveDomainId}/branding`, {
    body: { mode: "custom", name: "Denied" },
    idempotencyKey: `inactive-${stamp}`,
    expected: 403,
  });
  assertActionableError(inactiveWrite.body, "scope_blocked_by_entitlement");
  const missingIdempotency = await api(restToken, "POST", "/white-label/members", {
    body: { ...invitePayload, email: `missing-idem-${stamp}@example.test` },
    expected: 422,
  });
  assertActionableError(missingIdempotency.body, "missing_idempotency_key");
  const foreign = await api(restToken, "GET", `/white-label/members/${foreignMembershipId}`, { expected: 404 });
  assertActionableError(foreign.body, "not_found");
  const constrained = await api(constrainedToken, "PATCH", `/domains/${restDomainId}/branding`, {
    body: { mode: "off", scope: "all" },
    idempotencyKey: `constrained-${stamp}`,
    expected: 403,
  });
  assertActionableError(constrained.body, "domain_scope_forbidden");

  // The dedicated member limiter is 20/minute. Deliberately avoid depending on
  // how many earlier matrix requests consumed the same bucket: keep sending
  // harmless missing-resource writes until the first throttled response.
  let limited: { body: Json; response: Response } | null = null;
  let rateLimitAttempts = 0;
  for (; rateLimitAttempts < 25; rateLimitAttempts += 1) {
    const response = await api(restToken, "PATCH", "/white-label/members/999999999", {
      body: { note: `rate-${rateLimitAttempts}` },
      idempotencyKey: `rest-rate-${rateLimitAttempts}-${stamp}`,
      expected: [404, 429],
    });
    if (response.response.status === 429) {
      limited = response;
      break;
    }
    assertActionableError(response.body, "not_found");
  }
  assert(limited !== null, `Member rate limiter did not reject ${rateLimitAttempts} requests`);
  assertActionableError(limited.body, "rate_limited");

  return {
    success_operations: new Set(successes).size,
    denied_operations: failureSpecs.length,
    extra_failures: 9,
    rate_limit: { status: "pass", attempts_until_429: rateLimitAttempts + 1 },
  };
}

type Connected = {
  client: Client;
  close: () => Promise<void>;
};

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function connectStdio(
  token: string,
  safety: { destructive: boolean; sending: boolean },
): Promise<Connected> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(packageDir, "build/index.js")],
    cwd: packageDir,
    env: {
      ...process.env,
      TREKMAIL_BASE_URL: baseUrl,
      TREKMAIL_API_TOKEN: token,
      TREKMAIL_TOOLSETS: "white_label",
      TREKMAIL_SCOPE_AWARE_REGISTRATION: "true",
      TREKMAIL_ALLOW_DESTRUCTIVE: safety.destructive ? "true" : "false",
      TREKMAIL_ALLOW_SENDING: safety.sending ? "true" : "false",
      TREKMAIL_TIMEOUT_MS: "30000",
    } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "trekmail-white-label-live-stdio", version: "1" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

async function connectHttp(token: string): Promise<Connected> {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "trekmail-white-label-live-http", version: "1" });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await transport.terminateSession().catch(() => undefined);
      await client.close();
    },
  };
}

async function listedNamesOrNone(client: Client): Promise<string[]> {
  try {
    return (await client.listTools()).tools.map((tool) => tool.name);
  } catch (error) {
    if (/method not found|does not support tools/i.test(String(error))) return [];
    throw error;
  }
}

function toolPayload(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = result.content.find((item) => item.type === "text")?.text;
  if (typeof text !== "string" || text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function toolOk(client: Client, name: string, args: Json = {}): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError === true) {
    throw new Error(`${name} returned MCP error: ${JSON.stringify(result.content)}`);
  }
  return toolPayload(result);
}

async function toolError(
  client: Client,
  name: string,
  args: Json,
  pattern?: RegExp,
): Promise<unknown> {
  const result = await client.callTool({ name, arguments: args });
  const payload = toolPayload(result);
  assert(result.isError === true, `${name} unexpectedly succeeded: ${JSON.stringify(payload)}`);
  if (pattern) {
    assert(pattern.test(JSON.stringify(payload)), `${name} error did not match ${pattern}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function toolUnavailable(client: Client, name: string): Promise<void> {
  try {
    const result = await client.callTool({ name, arguments: {} });
    const payload = toolPayload(result);
    assert(
      result.isError === true && /not found|method/i.test(JSON.stringify(payload)),
      `${name} unexpectedly remained callable: ${JSON.stringify(payload)}`,
    );
  } catch (error) {
    assert(
      /not found|method/i.test(String(error)),
      `${name} failed for an unexpected reason: ${String(error)}`,
    );
  }
}

async function runMcpSuccessMatrix(
  transportName: "stdio" | "streamable-http",
  connected: Connected,
  domainId: number,
): Promise<Record<string, unknown>> {
  const { client } = connected;
  const listed = await listedNamesOrNone(client);
  assert(listed.length === 20, `${transportName}: expected 20 tools, received ${listed.length}`);
  assert(WHITE_LABEL_TOOLS.every((name) => listed.includes(name)), `${transportName}: White Label catalog mismatch`);

  const successes = new Set<string>();
  const ok = async (name: string, args: Json = {}): Promise<unknown> => {
    const payload = await toolOk(client, name, args);
    successes.add(name);
    return payload;
  };

  const label = transportName === "stdio" ? "stdio" : "http";
  const overview = await ok("get_white_label") as Json;
  assert((overview.entitlement as Json)?.state === "active", `${transportName}: overview not active`);
  await ok("get_white_label_access_catalog");

  const brand = await ok("set_domain_branding", {
    domain_id: domainId,
    mode: "custom",
    name: `${label.toUpperCase()} Live ${stamp}`,
    primary_color: "#234567",
    accent_color: "#fedcba",
    dashboard_enabled: true,
    dashboard_label: `${label}dash`,
    webmail_enabled: true,
    webmail_label: `${label}mail`,
    mail_zone_enabled: false,
    support_email: `${label}-support-${stamp}@example.test`,
    support_url: "https://support.example.test/help",
    scope: "domain",
  }) as Json;
  assert((brand.data as Json)?.mode === "custom", `${transportName}: brand update failed`);
  await ok("get_domain_branding", { domain_id: domainId });
  const logo = await ok("set_domain_brand_logo", {
    domain_id: domainId,
    slot: "light",
    content_base64: PNG_1X1,
  }) as Json;
  assert(typeof (((logo.data as Json)?.brand as Json)?.logo_url) === "string", `${transportName}: logo missing`);
  await ok("remove_domain_brand_logo", { domain_id: domainId, slot: "light" });
  const dns = await ok("verify_domain_branding_dns", { domain_id: domainId }) as Json;
  assert((dns.data as Json)?.status === "queued", `${transportName}: DNS check not queued`);
  const preview = await ok("create_branding_preview", { domain_id: domainId }) as Json;
  assert(typeof (preview.data as Json)?.url === "string", `${transportName}: preview URL missing`);

  const inviteArgs = {
    email: `${label}-client-${stamp}@example.test`,
    role: "client",
    all_domains: false,
    domain_ids: [domainId],
    note: `${transportName} live invitation`,
  };
  const invited = await ok("invite_white_label_member", inviteArgs) as Json;
  const memberId = Number(invited.id);
  assert(Number.isInteger(memberId) && memberId > 0, `${transportName}: invitation returned no member id`);
  assert(invited.note === `${transportName} live invitation`, `${transportName}: invitation note missing`);
  const replay = await toolOk(client, "invite_white_label_member", inviteArgs) as Json;
  assert(
    String((replay.invitation as Json)?.url).includes("<redacted>"),
    `${transportName}: MCP replay exposed invitation token`,
  );

  await ok("list_white_label_members", { search: `${label}-client-${stamp}` });
  await ok("get_white_label_member", { member_id: memberId });
  const updated = await ok("update_white_label_member", {
    member_id: memberId,
    note: `${transportName} live updated`,
  }) as Json;
  assert(updated.note === `${transportName} live updated`, `${transportName}: member update failed`);
  await ok("suspend_white_label_member", { member_id: memberId });
  await toolError(client, "suspend_white_label_member", {
    member_id: memberId,
    idempotency_key: `${label}-invalid-transition-${stamp}`,
  }, /membership_state_conflict/);
  await ok("resume_white_label_member", { member_id: memberId });
  await ok("resend_white_label_invitation", { member_id: memberId });
  await ok("list_white_label_activity", { member_id: memberId, per_page: 10 });
  await ok("get_white_label_member_activity", { member_id: memberId, limit: 10 });
  await ok("remove_white_label_member", { member_id: memberId, confirm_remove: true });
  await ok("restore_white_label_member", { member_id: memberId });
  await ok("remove_domain_branding", { domain_id: domainId, scope: "domain" });

  for (const name of WHITE_LABEL_TOOLS) {
    assert(successes.has(name), `${transportName}: success matrix missed ${name}`);
  }

  await toolError(client, "get_domain_branding", { domain_id: 999999999 }, /not_found/);
  await toolError(client, "get_white_label_member", { member_id: 999999999 }, /not_found/);
  await toolError(client, "list_white_label_activity", { member_id: 999999999 }, /not_found/);
  await toolError(client, "get_white_label_member_activity", { member_id: 999999999 }, /not_found/);

  return {
    transport: transportName,
    advertised_tools: listed.length,
    successful_tools: successes.size,
    replay_redaction: "pass",
    invalid_state: "pass",
    invalid_resource_reads: 4,
  };
}

async function runStdioSafetyFailures(): Promise<Record<string, unknown>> {
  const connected = await connectStdio(stdioToken, { destructive: false, sending: false });
  try {
    const names = await listedNamesOrNone(connected.client);
    const readableTools = WHITE_LABEL_TOOLS.filter((name) => !MUTATING_TOOLS.includes(name as (typeof MUTATING_TOOLS)[number]));
    assert(names.length === readableTools.length, `stdio safety: expected ${readableTools.length} tools, received ${names.length}`);
    assert(readableTools.every((name) => names.includes(name)), "stdio safety: read-only catalog mismatch");
    for (const name of MUTATING_TOOLS) {
      assert(!names.includes(name), `stdio safety: ${name} remained advertised`);
      await toolUnavailable(connected.client, name);
    }
    return {
      advertised_read_tools: readableTools.length,
      hidden_mutating_tools: MUTATING_TOOLS.length,
      rejected_direct_calls: MUTATING_TOOLS.length,
    };
  } finally {
    await connected.close();
  }
}

async function assertNoWhiteLabelTools(
  label: string,
  connected: Connected,
): Promise<Record<string, unknown>> {
  try {
    const names = await listedNamesOrNone(connected.client);
    const exposed = WHITE_LABEL_TOOLS.filter((name) => names.includes(name));
    assert(exposed.length === 0, `${label}: exposed tools ${exposed.join(", ")}`);
    for (const name of WHITE_LABEL_TOOLS) {
      await toolUnavailable(connected.client, name);
    }
    return { label, exposed_white_label_tools: 0, rejected_direct_calls: WHITE_LABEL_TOOLS.length };
  } finally {
    await connected.close();
  }
}

async function runAll(): Promise<void> {
  const rest = await runRestMatrix();

  const stdio = await connectStdio(stdioToken, { destructive: true, sending: true });
  let stdioSuccess: Record<string, unknown>;
  try {
    stdioSuccess = await runMcpSuccessMatrix("stdio", stdio, stdioDomainId);
  } finally {
    await stdio.close();
  }
  const stdioSafety = await runStdioSafetyFailures();
  const stdioNoScope = await assertNoWhiteLabelTools(
    "stdio-no-scope",
    await connectStdio(noScopeToken, { destructive: true, sending: true }),
  );
  const stdioInactive = await assertNoWhiteLabelTools(
    "stdio-inactive-entitlement",
    await connectStdio(inactiveToken, { destructive: true, sending: true }),
  );

  const hosted = await connectHttp(oauthToken);
  let hostedSuccess: Record<string, unknown>;
  try {
    hostedSuccess = await runMcpSuccessMatrix("streamable-http", hosted, httpDomainId);
  } finally {
    await hosted.close();
  }
  const hostedInactive = await assertNoWhiteLabelTools(
    "http-inactive-entitlement",
    await connectHttp(inactiveOauthToken),
  );
  const hostedNoScope = await assertNoWhiteLabelTools(
    "http-no-scope",
    await connectHttp(noScopeOauthToken),
  );

  const noBearer = await fetch(mcpUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  assert(noBearer.status === 401, `hosted MCP missing bearer returned ${noBearer.status}`);
  assert(noBearer.headers.get("www-authenticate")?.includes("resource_metadata="), "Hosted 401 lacks OAuth discovery hint");

  let wrongAudienceDenied = false;
  try {
    const wrong = await connectHttp(wrongAudienceOauthToken);
    await wrong.close();
  } catch (error) {
    wrongAudienceDenied = /401|invalid_token/i.test(String(error));
  }
  assert(wrongAudienceDenied, "Hosted MCP accepted a token with the wrong audience");

  process.stdout.write(`${JSON.stringify({
    status: "pass",
    rest,
    stdio: {
      success: stdioSuccess,
      safety_failures: stdioSafety,
      no_scope: stdioNoScope,
      inactive: stdioInactive,
    },
    hosted_http: {
      success: hostedSuccess,
      no_scope: hostedNoScope,
      inactive: hostedInactive,
      missing_bearer: "401 with discovery",
      wrong_audience: "denied",
    },
  }, null, 2)}\n`);
}

await runAll();
