import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "node:crypto";

function positiveEnv(name: string): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
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

const domainId = positiveEnv("MCP_E2E_FORWARDING_DOMAIN_ID");
const runId = randomUUID();
const localPart = `pro-audit-${runId.slice(0, 8)}`;
const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
env.TREKMAIL_SCOPE_AWARE_REGISTRATION = "true";
env.TREKMAIL_ALLOW_DESTRUCTIVE = "true";
delete env.TREKMAIL_MESSAGE_TOKEN;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["build/index.js"],
  cwd: process.cwd(),
  env,
  stderr: "pipe",
});
const client = new Client({ name: "trekmail-forwarding-pro-e2e", version: "1" });
let createdId: number | null = null;

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  for (const required of [
    "list_forwarding_addresses",
    "get_forwarding_address_log",
    "create_forwarding_address",
    "update_forwarding_address",
    "delete_forwarding_address",
  ]) {
    if (!names.includes(required)) throw new Error(`Required tool missing: ${required}`);
  }

  const before = await callJson(client, "list_forwarding_addresses", { domain_id: domainId });
  const limits = before.limits as Record<string, unknown>;
  const delivery = before.delivery as Record<string, unknown>;
  if (limits.max !== 100 || delivery.active !== true || delivery.requires_plan !== "pro") {
    throw new Error(`Pro delivery contract is wrong: ${JSON.stringify({ limits, delivery })}`);
  }

  const created = await callJson(client, "create_forwarding_address", {
    domain_id: domainId,
    local_part: localPart,
    recipients: ["trekmail-forwarding-audit@gmail.com"],
    idempotency_key: `pro-forward-create-${runId}`,
  });
  const createdData = created.data as Record<string, unknown>;
  createdId = Number(createdData.id);
  if (!Number.isInteger(createdId) || createdData.is_active !== true) {
    throw new Error(`Create returned an invalid address: ${JSON.stringify(created)}`);
  }

  const paused = await callJson(client, "update_forwarding_address", {
    domain_id: domainId,
    forwarding_address_id: createdId,
    is_active: false,
  });
  if ((paused.data as Record<string, unknown>).is_active !== false) {
    throw new Error(`Pause did not stick: ${JSON.stringify(paused)}`);
  }

  const log = await callJson(client, "get_forwarding_address_log", {
    domain_id: domainId,
    forwarding_address_id: createdId,
    limit: 1,
  });
  if ((log.window as Record<string, unknown>).retention_days !== 7) {
    throw new Error(`Pro retention is not 7 days: ${JSON.stringify(log.window)}`);
  }

  await callJson(client, "delete_forwarding_address", {
    domain_id: domainId,
    forwarding_address_id: createdId,
    idempotency_key: `pro-forward-delete-${runId}`,
  });
  createdId = null;

  process.stdout.write(`${JSON.stringify({
    status: "pass",
    protocol: "stdio",
    tools: names.length,
    domainId,
    plan: "pro",
    limit: 100,
    retentionDays: 7,
    sequence: ["listed", "created", "paused", "log_read", "deleted"],
  })}\n`);
} finally {
  if (createdId !== null) {
    await callJson(client, "delete_forwarding_address", {
      domain_id: domainId,
      forwarding_address_id: createdId,
      idempotency_key: `pro-forward-cleanup-${runId}`,
    }).catch(() => undefined);
  }
  await client.close();
}
