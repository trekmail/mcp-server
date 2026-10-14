#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, PACKAGE_VERSION } from "./config.js";
import { TrekMailClient, makeClientConfig } from "./client.js";
import { registerInfraTools, registerMessageTools } from "./tools/index.js";
import { withToolFilter } from "./tool-filter.js";
import { ensureToolListCapability } from "./tool-list-capability.js";
import type { ToolResourceConstraints } from "./tool-catalog.js";

const config = loadConfig();

const server = new McpServer({
  name: "TrekMail",
  version: PACKAGE_VERSION,
});
ensureToolListCapability(server);
// Create clients conditionally based on available tokens
const opsClient = config.apiToken
  ? new TrekMailClient(makeClientConfig(config, config.apiToken))
  : null;

const msgClient = config.messageToken
  ? new TrekMailClient(makeClientConfig(config, config.messageToken))
  : null;

interface DiscoveredCapabilities {
  scopes: string[];
  /** Undefined when the endpoint does not report constraints. */
  constraints?: ToolResourceConstraints;
}

function capabilitiesFrom(response: unknown): DiscoveredCapabilities {
  if (typeof response !== "object" || response === null) {
    throw new Error("Capability endpoint returned a non-object response");
  }
  const capabilities = (response as { capabilities?: unknown }).capabilities;
  if (typeof capabilities !== "object" || capabilities === null) {
    throw new Error("Capability endpoint omitted capabilities");
  }
  const scopes = (capabilities as { effective_scopes?: unknown }).effective_scopes;
  if (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === "string")) {
    throw new Error("Capability endpoint omitted effective_scopes");
  }
  return { scopes, constraints: constraintsFrom((capabilities as { constraints?: unknown }).constraints) };
}

/**
 * GET /me reports `constraints: {domain_ids, mailbox_ids}`, each null for
 * "all" or a list of ids. Null or absent means all; a list, or any malformed
 * value, counts as confined, so a bad answer hides the account-wide tools
 * rather than offering them. No constraints object at all hides nothing.
 */
function constraintsFrom(value: unknown): ToolResourceConstraints | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const ids = (candidate: unknown): readonly number[] | null => {
    if (candidate === null || candidate === undefined) return null;
    return Array.isArray(candidate)
      ? candidate.filter((id): id is number => typeof id === "number")
      : [];
  };
  const raw = value as { domain_ids?: unknown; mailbox_ids?: unknown };
  return { domainIds: ids(raw.domain_ids), mailboxIds: ids(raw.mailbox_ids) };
}

async function discoverCapabilities(
  client: TrekMailClient,
  credential: "API" | "message",
): Promise<DiscoveredCapabilities | undefined> {
  if (!config.scopeAwareRegistration) return undefined;

  try {
    const response = credential === "API"
      ? await client.getMe()
      : await client.getMessageMe();
    return capabilitiesFrom(response);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot discover ${credential} token capabilities while ` +
      `TREKMAIL_SCOPE_AWARE_REGISTRATION=true: ${detail}`,
    );
  }
}

const [opsCapabilities, messageCapabilities] = await Promise.all([
  opsClient ? discoverCapabilities(opsClient, "API") : undefined,
  msgClient ? discoverCapabilities(msgClient, "message") : undefined,
]);

// Register tools based on which tokens are available
if (opsClient) {
  registerInfraTools(withToolFilter(server, {
    transport: "stdio",
    toolsets: config.toolsets,
    capabilities: opsCapabilities?.scopes,
    constraints: opsCapabilities?.constraints,
    readOnly: config.readOnly,
    safety: {
      destructive: config.allowDestructive,
      sending: config.allowSending,
      migration: config.allowMigration,
    },
  }), opsClient, config);
}
if (msgClient) {
  registerMessageTools(withToolFilter(server, {
    transport: "stdio",
    toolsets: config.toolsets,
    capabilities: messageCapabilities?.scopes,
    constraints: messageCapabilities?.constraints,
    readOnly: config.readOnly,
    safety: {
      destructive: config.allowDestructive,
      sending: config.allowSending,
      migration: config.allowMigration,
    },
  }), msgClient, config);
}

const transport = new StdioServerTransport();
await server.connect(transport);

const toolSets = [
  opsClient && "infra",
  msgClient && "messages",
].filter(Boolean);
console.error(`TrekMail MCP Server running on stdio (tools: ${toolSets.join(", ")})`);
