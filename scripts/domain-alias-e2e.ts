import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";

function positiveEnv(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = result.content.find((candidate) => candidate.type === "text");
  if (!block || block.type !== "text") throw new Error("Tool result has no text content");
  return block.text;
}

async function callJson(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const text = textContent(result);
  if (result.isError === true) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as Record<string, unknown>;
}

const sourceDomainId = positiveEnv("MCP_E2E_ALIAS_DOMAIN_ID");
const primaryDomainId = positiveEnv("MCP_E2E_PRIMARY_DOMAIN_ID");
const runId = randomUUID();
const packageDir = process.cwd();
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

env.TREKMAIL_SCOPE_AWARE_REGISTRATION = "true";
env.TREKMAIL_ALLOW_DESTRUCTIVE = "true";
delete env.TREKMAIL_MESSAGE_TOKEN;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["build/index.js"],
  cwd: packageDir,
  env,
  stderr: "pipe",
});
const client = new Client({ name: "trekmail-ticket-369-e2e", version: "1" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  for (const required of ["get_domain_alias", "set_domain_alias", "remove_domain_alias"]) {
    if (!names.includes(required)) throw new Error(`Required tool missing: ${required}`);
  }

  await callJson(client, "remove_domain_alias", {
    domain_id: sourceDomainId,
    confirm_remove: true,
    idempotency_key: `ticket369-demo-reset-${runId}`,
  });
  const before = await callJson(client, "get_domain_alias", { domain_id: sourceDomainId });
  if (before.configured !== false || before.status !== "not_configured") {
    throw new Error(`Unexpected initial state: ${JSON.stringify(before)}`);
  }

  const connected = await callJson(client, "set_domain_alias", {
    domain_id: sourceDomainId,
    primary_domain_id: primaryDomainId,
    idempotency_key: `ticket369-demo-connect-${runId}`,
  });
  if (connected.configured !== true || connected.delivering !== true) {
    throw new Error(`Connection did not start delivering: ${JSON.stringify(connected)}`);
  }

  const confirmed = await callJson(client, "get_domain_alias", { domain_id: sourceDomainId });
  if (confirmed.status !== "delivering") {
    throw new Error(`Saved connection is not delivering: ${JSON.stringify(confirmed)}`);
  }

  const removed = await callJson(client, "remove_domain_alias", {
    domain_id: sourceDomainId,
    confirm_remove: true,
    idempotency_key: `ticket369-demo-remove-${runId}`,
  });
  if (removed.configured !== false || removed.status !== "not_configured") {
    throw new Error(`Connection was not removed: ${JSON.stringify(removed)}`);
  }

  process.stdout.write(`${JSON.stringify({
    status: "pass",
    protocol: "stdio",
    tools: names.length,
    sourceDomainId,
    primaryDomainId,
    sequence: ["not_configured", "delivering", "not_configured"],
  })}\n`);
} finally {
  await client.close();
}
