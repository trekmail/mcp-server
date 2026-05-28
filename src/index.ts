#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { TrekMailClient, makeClientConfig } from "./client.js";
import { registerInfraTools, registerMessageTools } from "./tools/index.js";

const config = loadConfig();

const server = new McpServer({
  name: "TrekMail",
  version: "1.2.0",
});

// Create clients conditionally based on available tokens
const opsClient = config.apiToken
  ? new TrekMailClient(makeClientConfig(config, config.apiToken))
  : null;

const msgClient = config.messageToken
  ? new TrekMailClient(makeClientConfig(config, config.messageToken))
  : null;

// Register tools based on which tokens are available
if (opsClient) {
  registerInfraTools(server, opsClient, config);
}
if (msgClient) {
  registerMessageTools(server, msgClient, config);
}

const transport = new StdioServerTransport();
await server.connect(transport);

const toolSets = [
  opsClient && "infra",
  msgClient && "messages",
].filter(Boolean);
console.error(`TrekMail MCP Server running on stdio (tools: ${toolSets.join(", ")})`);
