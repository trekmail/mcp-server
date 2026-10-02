import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const rootDir = resolve(packageDir, "../..");

function localEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    APP_ENV: "local",
    DB_CONNECTION: "pgsql",
    DB_HOST: "127.0.0.1",
    DB_DIRECT_HOST: "127.0.0.1",
    DB_PORT: "55432",
    DB_DIRECT_PORT: "55432",
    DB_DATABASE: "trekmail_mcp_e2e",
    DB_USERNAME: "root",
    DB_PASSWORD: "trekmail_test_local",
  };
}

function artisan(args: string[]): string {
  return execFileSync("php", ["artisan", ...args], {
    cwd: rootDir,
    env: localEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function textContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const block = result.content.find((candidate) => candidate.type === "text");
  if (!block || block.type !== "text") throw new Error("Tool result has no text content");
  return block.text;
}

const ids = JSON.parse(artisan([
  "tinker",
  "--execute=$a=App\\Models\\Account::whereHas('owner',fn($q)=>$q->where('email','mcp-e2e@local.invalid'))->firstOrFail();$allowed=App\\Models\\Domain::where('account_id',$a->id)->where('name','mcp-e2e.local.invalid')->firstOrFail();$other=App\\Models\\Domain::firstOrCreate(['account_id'=>$a->id,'name'=>'mcp-e2e-outside.local.invalid'],['status'=>'active']);echo json_encode(['allowed'=>$allowed->id,'other'=>$other->id]);",
])) as { allowed: number; other: number };
const matrix = JSON.parse(artisan([
  "mcp:e2e-static-token-matrix",
  "--scope=domains:read",
  `--domain-id=${ids.allowed}`,
])) as Record<string, { token: string }>;

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);
env.TREKMAIL_BASE_URL = "http://127.0.0.1:18080";
env.TREKMAIL_API_TOKEN = matrix["domains:read"].token;
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
const client = new Client({ name: "trekmail-resource-constraints-e2e", version: "1" });
try {
  await client.connect(transport);
  const listed = await client.callTool({ name: "list_domains", arguments: {} });
  if (listed.isError === true) throw new Error("Constrained list_domains failed");
  const payload = JSON.parse(textContent(listed)) as { data?: Array<{ id: number }> };
  const returnedIds = (payload.data ?? []).map((domain) => domain.id);
  if (returnedIds.length !== 1 || returnedIds[0] !== ids.allowed) {
    throw new Error(`Constraint leak: returned domain IDs ${returnedIds.join(",")}`);
  }

  const forbidden = await client.callTool({
    name: "get_domain",
    arguments: { domain_id: ids.other },
  });
  const forbiddenText = textContent(forbidden);
  if (forbidden.isError !== true || !/not[_ -]?found|404/i.test(forbiddenText)) {
    throw new Error(`Cross-constraint lookup returned: ${forbiddenText}`);
  }
  process.stdout.write(`${JSON.stringify({
    status: "pass",
    listedDomainIds: returnedIds,
    hiddenDomainId: ids.other,
    crossConstraintResult: "404",
  })}\n`);
} finally {
  await client.close();
}
