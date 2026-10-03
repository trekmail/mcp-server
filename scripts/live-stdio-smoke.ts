import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedCount = Number(process.env.SMOKE_EXPECTED_TOOL_COUNT ?? "0");
const required = (process.env.SMOKE_REQUIRED_TOOLS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const forbidden = (process.env.SMOKE_FORBIDDEN_TOOLS ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["build/index.js"],
  cwd: process.cwd(),
  env: { ...process.env } as Record<string, string>,
  stderr: "pipe",
});
const client = new Client({ name: "trekmail-live-stdio-smoke", version: "1" });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);

  if (expectedCount > 0 && names.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} tools, received ${names.length}`);
  }
  for (const name of required) {
    if (!names.includes(name)) throw new Error(`Required tool missing: ${name}`);
  }
  for (const name of forbidden) {
    if (names.includes(name)) throw new Error(`Forbidden tool present: ${name}`);
  }

  let call: { tool: string; isError: boolean; contentItems: number } | undefined;
  const callTool = process.env.SMOKE_CALL_TOOL;
  if (callTool) {
    const args = JSON.parse(process.env.SMOKE_CALL_ARGS ?? "{}");
    const result = await client.callTool({ name: callTool, arguments: args });
    call = {
      tool: callTool,
      isError: result.isError === true,
      contentItems: Array.isArray(result.content) ? result.content.length : 0,
    };
    if (call.isError) throw new Error(`Tool call returned isError: ${callTool}`);
  }

  process.stdout.write(`${JSON.stringify({
    protocol: "stdio",
    tools: names.length,
    first: names.slice(0, 5),
    call,
  })}\n`);
} finally {
  await client.close();
}
