import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  TOOL_CATALOG,
  catalogEntryForTool,
} from "../src/tool-catalog.js";

type Credential = { kind: "api" | "message"; token: string };
type ScopeResult = {
  scope: string;
  kind: Credential["kind"];
  tools: number;
  schemaBytes: number;
  deniedProbe: string;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const rootDir = resolve(packageDir, "../..");
const requestedScopes = process.argv
  .filter((argument) => argument.startsWith("--scope="))
  .map((argument) => argument.slice("--scope=".length));

function stringEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => (
      typeof entry[1] === "string"
    )),
  );
}

function commandEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APP_ENV: "local",
    DB_CONNECTION: "pgsql",
    DB_HOST: process.env.DB_HOST ?? "127.0.0.1",
    DB_DIRECT_HOST: process.env.DB_DIRECT_HOST ?? "127.0.0.1",
    DB_PORT: process.env.DB_PORT ?? "55432",
    DB_DIRECT_PORT: process.env.DB_DIRECT_PORT ?? "55432",
    DB_DATABASE: "trekmail_mcp_e2e",
    DB_USERNAME: process.env.DB_USERNAME ?? "root",
    DB_PASSWORD: process.env.DB_PASSWORD ?? "trekmail_test_local",
  };
}

function mintMatrix(scopes: string[]): Record<string, Credential> {
  const output = execFileSync("php", [
    "artisan",
    "mcp:e2e-static-token-matrix",
    ...scopes.map((scope) => `--scope=${scope}`),
  ], {
    cwd: rootDir,
    env: commandEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output.trim()) as Record<string, Credential>;
}

function isMessageTool(name: string): boolean {
  return catalogEntryForTool(name)?.anyOfCapabilities.some(
    (capability) => capability.startsWith("messages:"),
  ) ?? false;
}

function expectedNames(scope: string, kind: Credential["kind"]): string[] {
  return TOOL_CATALOG
    .filter((entry) => entry.transports.includes("stdio"))
    .filter((entry) => kind === "message" ? isMessageTool(entry.name) : !isMessageTool(entry.name))
    .filter((entry) => entry.anyOfCapabilities.includes(scope))
    .map((entry) => entry.name);
}

function sameNames(actual: readonly string[], expected: readonly string[]): boolean {
  const sortedExpected = [...expected].sort();
  return actual.length === expected.length
    && [...actual].sort().every((name, index) => name === sortedExpected[index]);
}

async function verify(scope: string, credential: Credential): Promise<ScopeResult> {
  const env = stringEnvironment();
  env.TREKMAIL_BASE_URL = process.env.TREKMAIL_BASE_URL ?? "http://127.0.0.1:18080";
  env.TREKMAIL_SCOPE_AWARE_REGISTRATION = "true";
  env.TREKMAIL_ALLOW_DESTRUCTIVE = "true";
  env.TREKMAIL_ALLOW_SENDING = "true";
  env.TREKMAIL_ALLOW_MIGRATION = "true";
  delete env.TREKMAIL_API_TOKEN;
  delete env.TREKMAIL_MESSAGE_TOKEN;
  if (credential.kind === "message") {
    env.TREKMAIL_MESSAGE_TOKEN = credential.token;
  } else {
    env.TREKMAIL_API_TOKEN = credential.token;
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["build/index.js"],
    cwd: packageDir,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "trekmail-stdio-scope-matrix", version: "1" });
  try {
    await client.connect(transport);
    const response = await client.listTools();
    const actual = response.tools.map((tool) => tool.name);
    const expected = expectedNames(scope, credential.kind);
    if (!sameNames(actual, expected)) {
      const missing = expected.filter((name) => !actual.includes(name));
      const extra = actual.filter((name) => !expected.includes(name));
      throw new Error(
        `${scope}: tools/list mismatch; missing=${missing.join(",")} extra=${extra.join(",")}`,
      );
    }
    for (const tool of response.tools) {
      const entry = catalogEntryForTool(tool.name);
      if (!entry) throw new Error(`${scope}: uncatalogued tool ${tool.name}`);
      if (tool.annotations?.readOnlyHint !== (entry.access === "read")) {
        throw new Error(`${scope}: readOnlyHint mismatch for ${tool.name}`);
      }
      if (tool.annotations?.destructiveHint !== (entry.safetyGate === "destructive")) {
        throw new Error(`${scope}: destructiveHint mismatch for ${tool.name}`);
      }
    }
    const deniedProbe = TOOL_CATALOG.find((entry) => (
      entry.transports.includes("stdio") && !actual.includes(entry.name)
    ))?.name;
    if (!deniedProbe) throw new Error(`${scope}: no absent tool for denial probe`);
    let denied = false;
    try {
      const result = await client.callTool({ name: deniedProbe, arguments: {} });
      denied = result.isError === true;
    } catch {
      denied = true;
    }
    if (!denied) throw new Error(`${scope}: unregistered tool unexpectedly succeeded`);

    return {
      scope,
      kind: credential.kind,
      tools: actual.length,
      schemaBytes: Buffer.byteLength(JSON.stringify(response.tools)),
      deniedProbe,
    };
  } finally {
    await client.close();
  }
}

const matrix = mintMatrix(requestedScopes);
const results: ScopeResult[] = [];
for (const [scope, credential] of Object.entries(matrix)) {
  const result = await verify(scope, credential);
  results.push(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
process.stdout.write(`${JSON.stringify({
  summary: {
    connections: results.length,
    api: results.filter((result) => result.kind === "api").length,
    message: results.filter((result) => result.kind === "message").length,
    status: "pass",
  },
})}\n`);
