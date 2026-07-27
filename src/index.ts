#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { TrekMailClient, makeClientConfig } from "./client.js";
import { registerInfraTools, registerMessageTools } from "./tools/index.js";
import { withToolFilter } from "./tool-filter.js";

const config = loadConfig();

const server = new McpServer({
  name: "TrekMail",
  version: "1.1.0",
});
// Create clients conditionally based on available tokens
const opsClient = config.apiToken
  ? new TrekMailClient(makeClientConfig(config, config.apiToken))
  : null;

const msgClient = config.messageToken
  ? new TrekMailClient(makeClientConfig(config, config.messageToken))
  : null;

function effectiveScopesFrom(response: unknown): string[] {
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
  return scopes;
}

async function discoverCapabilities(
  client: TrekMailClient,
  credential: "API" | "message",
): Promise<string[] | undefined> {
  if (!config.scopeAwareRegistration) return undefined;

  try {
    const response = credential === "API"
      ? await client.getMe()
      : await client.getMessageMe();
    return effectiveScopesFrom(response);
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
    capabilities: opsCapabilities,
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
    capabilities: messageCapabilities,
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
