import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TrekMailApiError, TrekMailClientError } from "../errors.js";

export function errorResult(text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

/**
 * Check if a hostname looks like a private/internal address.
 * Defense-in-depth: the backend API also validates, but we block
 * obviously private addresses at the MCP layer to prevent SSRF.
 */
export function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase().trim();

  // Loopback
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1") return true;
  if (lower.startsWith("127.")) return true;

  // Private IPv4 ranges
  if (lower.startsWith("10.")) return true;
  if (lower.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(lower)) return true;

  // Link-local / metadata
  if (lower.startsWith("169.254.")) return true;
  if (lower === "metadata.google.internal") return true;
  if (lower.startsWith("metadata")) return true;

  // IPv6 private
  if (lower.startsWith("fe80:") || lower.startsWith("fd") || lower.startsWith("fc")) return true;

  return false;
}

export async function callApi(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await fn();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    if (error instanceof TrekMailApiError) {
      return {
        content: [{ type: "text", text: error.toMcpText() }],
        isError: true,
      };
    }

    if (error instanceof TrekMailClientError) {
      return {
        content: [{ type: "text", text: `Client Error: ${error.message}` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
