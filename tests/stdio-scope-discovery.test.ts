import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The stdio server as a user runs it: src/index.ts reads the key's effective
 * capabilities and constraints from GET /api/v1/me and registers only the
 * tools they allow. The tool-filter tests prove the filter; this proves
 * index.ts feeds it what the API says, so a member key capped by its role, a
 * key without the scope, or a key confined to some domains never sees a tool
 * it cannot use (ticket #482).
 *
 * effective_scopes is what Laravel publishes after intersecting the key with
 * the plan and, for a member's key, the member's role (ApiCapabilityResolver);
 * constraints are the key's domain and mailbox confinement.
 */
const WRITER = ["members:read", "members:write", "mailboxes:read", "mailboxes:write"];
const ALL = { domain_ids: null, mailbox_ids: null };

const KEYS: Record<string, { scopes: string[]; constraints: Record<string, unknown> }> = {
  // A Custom role that may read the team but not change it.
  tm_live_members_read_only: { scopes: ["members:read", "mailboxes:read"], constraints: ALL },
  // The owner, or a member who may manage people and mailboxes.
  tm_live_members_and_mailbox_writer: { scopes: WRITER, constraints: ALL },
  // A Client's key: its role carries no members:* scope at all, whatever the key asked for.
  tm_live_client_role: { scopes: ["domains:read", "mailboxes:read", "mailboxes:write"], constraints: { domain_ids: [7], mailbox_ids: null } },
  // The same scopes as the writer, confined to some domains: the API refuses
  // it the account-wide writes (plan D12), so they are not loaded.
  tm_live_writer_confined_to_domains: { scopes: WRITER, constraints: { domain_ids: [7], mailbox_ids: null } },
  // Confined to some mailboxes only: still allowed a client limit, not the
  // account-wide default for new mailboxes.
  tm_live_writer_confined_to_mailboxes: { scopes: WRITER, constraints: { domain_ids: null, mailbox_ids: [9] } },
  // A malformed answer counts as confined: account-wide writes stay hidden.
  tm_live_writer_malformed_constraint: { scopes: WRITER, constraints: { domain_ids: "7", mailbox_ids: null } },
};

const STORAGE_TOOLS = [
  "update_account", "list_client_limits", "set_client_limit", "remove_client_limit", "set_mailbox_storage",
];

let api: Server;
let baseUrl: string;

beforeAll(async () => {
  api = createServer((request, response) => {
    const token = (request.headers.authorization ?? "").replace(/^Bearer /, "");
    const key = KEYS[token];
    if (request.url !== "/api/v1/me" || key === undefined) {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "not_found", message: "Not found." } }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      capabilities: { effective_scopes: key.scopes, constraints: key.constraints },
    }));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

async function storageToolsFor(token: string, allowDestructive = "true"): Promise<string[]> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)),
      fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    ],
    env: {
      TREKMAIL_BASE_URL: baseUrl,
      TREKMAIL_API_TOKEN: token,
      TREKMAIL_SCOPE_AWARE_REGISTRATION: "true",
      TREKMAIL_ALLOW_DESTRUCTIVE: allowDestructive,
      TREKMAIL_TIMEOUT_MS: "5000",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "scope-discovery-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    return STORAGE_TOOLS.filter((name) => names.includes(name));
  } finally {
    await client.close();
  }
}

describe("stdio registration follows the key's discovered capabilities", () => {
  it("shows each storage tool only to a key that can use it", async () => {
    const [readOnly, writer, clientRole, writerWithoutGate, domainConfined, mailboxConfined, malformed] = await Promise.all([
      storageToolsFor("tm_live_members_read_only"),
      storageToolsFor("tm_live_members_and_mailbox_writer"),
      storageToolsFor("tm_live_client_role"),
      storageToolsFor("tm_live_members_and_mailbox_writer", "false"),
      storageToolsFor("tm_live_writer_confined_to_domains"),
      storageToolsFor("tm_live_writer_confined_to_mailboxes"),
      storageToolsFor("tm_live_writer_malformed_constraint"),
    ]);

    // members:read without members:write: the list, never a change.
    expect(readOnly).toEqual(["list_client_limits"]);
    expect(writer).toEqual(STORAGE_TOOLS);
    // The role ceiling the API applied: no client-limit tool, mailbox storage stays.
    expect(clientRole).toEqual(["set_mailbox_storage"]);
    // The destructive gate hides every write, whatever the scopes.
    expect(writerWithoutGate).toEqual(["list_client_limits"]);
    // Same scopes, confined to some domains: no account-wide write is loaded;
    // the list (its own limits) and per-mailbox storage stay.
    expect(domainConfined).toEqual(["list_client_limits", "set_mailbox_storage"]);
    expect(mailboxConfined).toEqual(["list_client_limits", "set_client_limit", "remove_client_limit", "set_mailbox_storage"]);
    expect(malformed).toEqual(["list_client_limits", "set_mailbox_storage"]);
  }, 30000);
});
