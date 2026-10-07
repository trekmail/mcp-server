/** Real REST + MCP SDK clients against isolated, loopback-only release fixtures.
 * The fixture file is ignored, mode 0600, and contains short-lived synthetic grants.
 * Never point this harness at a customer account or a production server.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { encryptNote, unlockNote, decryptNote } from "../src/private-note-crypto.js";

const path = process.env.PRIVATE_NOTES_E2E_FIXTURE;
assert(path, "Set PRIVATE_NOTES_E2E_FIXTURE to an isolated fixture file");
const fixture = JSON.parse(readFileSync(path, "utf8"));
const base = fixture.base_url;
const mcpUrl = process.env.PRIVATE_NOTES_E2E_MCP_URL ?? "http://127.0.0.1:19080/mcp";
for (const url of [base, mcpUrl]) {
  assert.equal(new URL(url).hostname, "127.0.0.1", "Only loopback release servers are allowed");
}
const names = ["create_private_note_encrypted", "list_private_notes", "get_private_note_status",
  "update_private_note", "revoke_private_note", "consume_private_note_encrypted",
  "get_private_note_settings", "update_private_note_settings"];
const report: Record<string, unknown> = {};
const text = "Synthetic private note: <script>do not execute</script> 🔒";

async function rest(token: string, method: string, route: string, body?: unknown, host?: string) {
  const sessionHeaders: Record<string, string> = {};
  if (method === "POST" && /^\/n\/[^/]+\/consume$/.test(route)) {
    // Follow the real recipient browser flow, including Laravel's CSRF session.
    const page = await fetch(`${base}${route.replace(/\/consume$/, "")}`, {
      headers: host ? { Host: host, "X-Release-Test-Tenant": host } : {},
    });
    assert.equal(page.status, 200);
    const html = await page.text();
    const csrf = /name="csrf-token" content="([^"]+)"/.exec(html)?.[1];
    assert(csrf, "Reader page is missing its CSRF token");
    sessionHeaders["X-CSRF-TOKEN"] = csrf;
    sessionHeaders.Cookie = page.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
  }
  return fetch(`${base}${route}`, { method, headers: {
    Accept: "application/json", "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(host ? { Host: host, "X-Release-Test-Tenant": host } : {}), ...sessionHeaders,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}, error = false) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError === true, error, `${name}: unexpected error state`);
  if (error) return undefined;
  const block = result.content as Array<{ type: string; text?: string }>;
  const parsed = JSON.parse(block.find(item => item.type === "text")!.text!);
  return (parsed.result ?? parsed).data;
}
async function workflow(client: Client, context: Record<string, number> = {}) {
  const listed = (await client.listTools()).tools;
  for (const name of names) assert(listed.some(t => t.name === name), `${name}: absent`);
  for (const tool of listed.filter(t => names.includes(t.name))) {
    assert(tool.annotations?.title, `${tool.name}: missing annotation title`);
    for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"]) {
      assert.equal(typeof tool.annotations?.[hint], "boolean", `${tool.name}: missing ${hint}`);
    }
    if (client.getServerVersion()?.name === "trekmail" && process.env.PRIVATE_NOTES_E2E_PROFILE && process.env.PRIVATE_NOTES_E2E_PROFILE !== "legacy") {
      assert(tool.outputSchema && (tool._meta?.securitySchemes as unknown[])?.length === 1,
        `${tool.name}: missing directory output or OAuth metadata`);
    }
  }
  const create = listed.find(t => t.name === names[0])!;
  assert.equal(create.annotations?.destructiveHint, false);
  assert.equal(create.annotations?.openWorldHint, true);
  const consume = listed.find(t => t.name === names[5])!;
  assert.equal(consume.annotations?.destructiveHint, true);
  assert.equal(consume.annotations?.idempotentHint, false);
  const settings = await call(client, "get_private_note_settings", context);
  await call(client, "update_private_note_settings", { ...context, enabled: true });
  const encrypted = await encryptNote(text, "synthetic-separate-channel");
  await assert.rejects(unlockNote(encrypted.fragment, "wrong"));
  const args = { ...context, envelope: encrypted.envelope, policy: "once", expires_in: 604800,
    confirm_open: true, notify_self: false, idempotency_key: randomUUID() };
  const note = await call(client, names[0], args);
  assert(!note.reader_url.includes("#"), "A decryption fragment reached the server");
  assert.equal((await call(client, names[0], args)).id, note.id, "Idempotency did not hold");
  assert((await call(client, names[1], context)).some((n: any) => n.id === note.id));
  const metadata = await call(client, names[2], { ...context, note_id: note.id });
  assert(!("envelope" in metadata) && !("reader_url" in metadata));
  const updated = await call(client, names[3], { ...context, note_id: note.id, revision: metadata.revision,
    reference: "Synthetic handover", expires_in: 3600 });
  assert.equal(updated.revision, metadata.revision + 1);
  await call(client, names[3], { ...context, note_id: note.id, revision: metadata.revision, reference: "Stale" }, true);
  await call(client, names[5], { ...context, note_id: note.id, confirm_open: false }, true);
  const opened = await call(client, names[5], { ...context, note_id: note.id, confirm_open: true });
  assert.equal(await decryptNote(opened.envelope, await unlockNote(encrypted.fragment, "synthetic-separate-channel")), text);
  await call(client, names[5], { ...context, note_id: note.id, confirm_open: true }, true);
  await call(client, names[2], { ...context, note_id: note.id }, true);
  await call(client, names[0], args, true); // a replay cannot resurrect a consumed note
  const second = await call(client, names[0], { ...args, idempotency_key: randomUUID(), policy: "timed" });
  await call(client, names[5], { ...context, note_id: second.id, confirm_open: true });
  await call(client, names[5], { ...context, note_id: second.id, confirm_open: true });
  assert.equal((await call(client, names[4], { ...context, note_id: second.id })).revoked, true);
  await call(client, names[5], { ...context, note_id: second.id, confirm_open: true }, true);
  await call(client, names[7], { ...context, enabled: settings.enabled });
  return { lifecycle: true, tools: names.length, metadata_only: true, local_decryption: true };
}
async function http(role: string, host?: string) {
  process.stderr.write(`Checking HTTP role: ${role}\n`);
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: {
    Authorization: `Bearer ${fixture.http[role].token}`,
    ...(host ? { Host: host, "X-Release-Test-Tenant": host } : {}),
  } } });
  const client = new Client({ name: `private-notes-release-${role}`, version: "1" });
  await client.connect(transport);
  return { client, transport, close: async () => { await transport.terminateSession(); await client.close(); } };
}

const apiEncrypted = await encryptNote(text);
const payload = { envelope: apiEncrypted.envelope, policy: "once", expires_in: 3600, confirm_open: true };
const created = await rest(fixture.api_token, "POST", "/api/v1/private-notes", payload);
assert.equal(created.status, 201);
const note = (await created.json()).data;
const metadata = await rest("", "GET", `/n/${note.id}/metadata`);
assert.equal(metadata.status, 200);
assert(metadata.headers.get("cache-control")?.includes("no-store"));
assert(!JSON.stringify(await metadata.json()).includes("ciphertext"));
assert.equal((await rest(fixture.api_token, "POST", "/api/v1/private-notes", { ...payload, text: "forbidden" })).status, 422);
assert.equal((await rest(fixture.api_token, "POST", "/api/v1/private-notes", { ...payload, notify_self: true })).status, 403);
assert.equal((await rest("", "POST", `/n/${note.id}/consume`, { confirm_open: true })).status, 200);
assert.equal((await rest("", "POST", `/n/${note.id}/consume`, { confirm_open: true })).status, 404);
report.rest = { real_api: true, no_store: true, no_plaintext: true, no_machine_receipt: true };

const stdio = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL("../build/index.js", import.meta.url))],
  env: { TREKMAIL_BASE_URL: base, TREKMAIL_API_TOKEN: fixture.api_token,
    TREKMAIL_ALLOW_DESTRUCTIVE: "true", TREKMAIL_TIMEOUT_MS: "5000" }, stderr: "pipe" });
const stdioClient = new Client({ name: "private-notes-release-stdio", version: "1" });
try { await stdioClient.connect(stdio); report.stdio = await workflow(stdioClient); }
finally { await stdioClient.close(); }
const owner = await http("owner");
try { report.http = await workflow(owner.client); }
finally { await owner.close(); }

for (const [role, expected] of [["readonly", 3], ["operator", 7], ["domain_admin", 2], ["legacy", 0]] as const) {
  const connected = await http(role);
  try {
    const exposed = (await connected.client.listTools()).tools.filter(t => names.includes(t.name));
    assert.equal(exposed.length, expected, `${role}: unexpected Private Notes permissions`);
    if (role === "operator") {
      const n = await call(connected.client, names[0], { ...payload, domain_id: fixture.domain_id });
      await call(connected.client, names[4], { note_id: n.id, domain_id: fixture.domain_id });
      assert(!exposed.some(t => t.name === names[7]));
    }
    if (role === "domain_admin") await call(connected.client, names[7], { domain_id: fixture.domain_id, enabled: true });
    if (role === "readonly") {
      await call(connected.client, names[1], { domain_id: fixture.domain_id });
      const denied = await rest(fixture.http[role].token, "POST", "/api/v1/private-notes", { ...payload, domain_id: fixture.domain_id });
      assert.equal(denied.status, 403);
    }
    report[role] = { note_tools: exposed.length, permissions_checked: true };
  } finally { await connected.close(); }
}
const constrained = await http("constrained");
try {
  await call(constrained.client, names[0], payload, true);
  await call(constrained.client, names[0], { ...payload, domain_id: fixture.foreign_domain_id }, true);
  report.constraints = await workflow(constrained.client, { domain_id: fixture.domain_id });
} finally { await constrained.close(); }
const tenant = await http("tenant", fixture.tenant_host);
try {
  const branded = await call(tenant.client, names[0], { ...payload, domain_id: fixture.tenant_domain_id });
  assert.equal(new URL(branded.reader_url).hostname, fixture.tenant_host);
  assert.equal((await rest("", "POST", `/n/${branded.id}/consume`, { confirm_open: true })).status, 404);
  const landing = await rest("", "GET", "/tools/private-notes", undefined, fixture.tenant_host);
  assert.equal(landing.status, 404, "White Label tool was published without opt-in");
  const reader = await rest("", "GET", `/n/${branded.id}`, undefined, fixture.tenant_host);
  assert.equal(reader.status, 200);
  const html = await reader.text();
  assert(html.includes("Release Northstar") && !html.includes("About Private Notes"));
  assert.equal((await rest("", "POST", `/n/${branded.id}/consume`, { confirm_open: true }, fixture.tenant_host)).status, 200);
  report.white_label = { branded_host: true, foreign_host_denied: true, public_tool_opt_in: true };
} finally { await tenant.close(); }
if (process.env.PRIVATE_NOTES_E2E_CONTROL) {
  const live = await http("owner");
  try {
    await live.client.listTools();
    execFileSync("php", [process.env.PRIVATE_NOTES_E2E_CONTROL, "revoke"], { stdio: "ignore" });
    await assert.rejects(live.client.listTools(), /401|invalid_token|Unauthorized/i);
    report.revocation = { live_session_denied: true };
  } finally { await live.client.close(); }
}
process.stdout.write(JSON.stringify({ ok: true, ...report }, null, 2) + "\n");
