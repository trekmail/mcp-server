import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  catalogEntryForTool,
  hasCapabilityForTool,
  toolsForToolsets,
  type Toolset,
  type ToolTransport,
} from "./tool-catalog.js";

export interface ToolFilterOptions {
  transport: ToolTransport;
  /** Undefined preserves legacy full exposure. An empty array exposes none. */
  toolsets?: readonly Toolset[];
  /** Undefined preserves legacy exposure; an empty array exposes none. */
  capabilities?: readonly string[];
  /** Hide every write/destructive schema, independently of token scopes. */
  readOnly?: boolean;
  /** Omit tools whose existing environment safety gate is disabled. */
  safety?: {
    destructive: boolean;
    sending: boolean;
    migration: boolean;
  };
}

/**
 * Wrap an MCP server without touching existing tool factories. Calls to
 * registerTool that are outside the selected transport/toolsets are ignored,
 * so their JSON schemas never enter tools/list.
 */
export function withToolFilter(
  server: McpServer,
  options: ToolFilterOptions,
): McpServer {
  const selected = options.toolsets === undefined
    ? null
    : toolsForToolsets(options.toolsets);

  return new Proxy(server, {
    get(target, prop, receiver) {
      if (prop !== "registerTool") {
        return Reflect.get(target, prop, receiver);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (name: string, ...args: any[]) => {
        const entry = catalogEntryForTool(name);
        if (!entry || !entry.transports.includes(options.transport)) {
          return undefined;
        }
        if (selected !== null && !selected.has(name)) {
          return undefined;
        }
        if (
          options.capabilities !== undefined &&
          !hasCapabilityForTool(name, options.capabilities)
        ) {
          return undefined;
        }
        if (options.readOnly && entry.access !== "read") {
          return undefined;
        }
        if (entry.safetyGate && options.safety?.[entry.safetyGate] === false) {
          return undefined;
        }
        const [definition, handler] = args;
        const normalizedDefinition = {
          ...definition,
          annotations: {
            ...(definition?.annotations ?? {}),
            readOnlyHint: entry.access === "read",
            destructiveHint: entry.safetyGate === "destructive",
          },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (target.registerTool as any).call(
          target,
          name,
          normalizedDefinition,
          handler,
        );
      };
    },
  }) as McpServer;
}
