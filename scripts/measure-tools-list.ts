import { Buffer } from "node:buffer";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../src/config.js";
import type { TrekMailClient } from "../src/client.js";
import { registerInfraTools, registerMessageTools } from "../src/tools/index.js";
import { withToolFilter } from "../src/tool-filter.js";
import type { Toolset } from "../src/tool-catalog.js";

interface Scenario {
  name: string;
  infra: boolean;
  messages: boolean;
  httpTransport: boolean;
  toolsets?: readonly Toolset[];
  capabilities?: readonly string[];
  readOnly?: boolean;
}

const scenarios: readonly Scenario[] = [
  { name: "stdio-infra", infra: true, messages: false, httpTransport: false },
  { name: "stdio-message", infra: false, messages: true, httpTransport: false },
  { name: "stdio-full", infra: true, messages: true, httpTransport: false },
  { name: "http-full", infra: true, messages: true, httpTransport: true },
  {
    name: "email-project",
    infra: false,
    messages: true,
    httpTransport: false,
    toolsets: ["email"],
    capabilities: ["messages:read", "messages:write", "messages:send"],
  },
  {
    name: "email-project-read-only",
    infra: false,
    messages: true,
    httpTransport: false,
    toolsets: ["email"],
    capabilities: ["messages:read", "messages:write", "messages:send"],
    readOnly: true,
  },
  {
    name: "mailbox-drive-read-only",
    infra: true,
    messages: false,
    httpTransport: false,
    toolsets: ["drive"],
    capabilities: ["drive:mailbox:read"],
    readOnly: true,
  },
];

const dummyClient = new Proxy(
  {},
  { get: () => async () => ({}) },
) as TrekMailClient;

async function measure(scenario: Scenario): Promise<void> {
  const server = new McpServer({ name: "trekmail-baseline", version: "1" });
  const config: Config = {
    baseUrl: "https://baseline.invalid",
    apiToken: "tm_live_baseline",
    messageToken: "tm_msg_baseline",
    timeoutMs: 1,
    userAgent: "trekmail-mcp-baseline/1",
    allowDestructive: true,
    allowSending: true,
    allowMigration: true,
    httpTransport: scenario.httpTransport,
  };

  const registrationServer = withToolFilter(server, {
    transport: scenario.httpTransport ? "http" : "stdio",
    toolsets: scenario.toolsets,
    capabilities: scenario.capabilities,
    readOnly: scenario.readOnly,
  });
  if (scenario.infra) registerInfraTools(registrationServer, dummyClient, config);
  if (scenario.messages) registerMessageTools(registrationServer, dummyClient, config);

  const client = new Client({ name: "trekmail-baseline-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    const response = await client.listTools();
    const json = JSON.stringify(response.tools);
    process.stdout.write(
      `${scenario.name}\t${response.tools.length}\t${Buffer.byteLength(json)}\t${Math.ceil(json.length / 4)}\n`,
    );
  } finally {
    await client.close();
    await server.close();
  }
}

process.stdout.write("scenario\ttools\tjson_bytes\tapprox_tokens_chars_div_4\n");
for (const scenario of scenarios) {
  await measure(scenario);
}
