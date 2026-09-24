import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Keep tools/list protocol-valid when scope and toolset filtering exposes no
 * tools. Registering then removing an internal entry initializes the SDK's
 * empty tool-list handler without advertising a placeholder tool.
 */
export function ensureToolListCapability(server: McpServer): void {
  const initializer = server.registerTool(
    "trekmail_internal_tool_list_initializer",
    { description: "Internal MCP capability initializer." },
    async () => ({ content: [] }),
  );
  initializer.remove();
}
