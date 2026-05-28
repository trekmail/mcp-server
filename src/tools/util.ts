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
 *
 * Defense-in-depth: the backend API also validates via DNS-resolve +
 * IP-range check (App\Rules\SafeExternalHost). This client-side check
 * is a fast-fail before the API call, not the primary SSRF defense.
 *
 * Bypass classes handled (hardening for ticket #163, 2026-05-27;
 * Alibaba IMDS added for ticket #171, 2026-05-28):
 *   - IPv4 in any notation: dotted decimal, octal (0177.0.0.1),
 *     hex (0x7f.0.0.1), single 32-bit int (2130706433), short forms.
 *   - IPv4 ranges: 0/8, 10/8, 127/8, 169.254/16 (incl. AWS/Azure IMDS
 *     169.254.169.254), 172.16/12, 192.168/16, 224/4 (multicast),
 *     240/4 (reserved). Also 100.100.100.200/32 (Alibaba Cloud IMDS).
 *   - IPv6: loopback ::1, unspecified `[::]` / 0:0:..:0, link-local fe80::/10,
 *     unique-local fc00::/7, IPv4-mapped ::ffff:127.0.0.1.
 *   - Hostnames: literal `localhost`, `*.localhost`, cloud metadata DNS
 *     names (GCP, AWS, Alibaba).
 *
 * NOT handled here: DNS-resolution bypass (e.g. `127.0.0.1.nip.io` resolves
 * to 127.0.0.1). That class is caught at the backend by gethostbynamel +
 * range check; doing DNS resolution synchronously in MCP would block tool
 * calls and add a network round-trip to every host validation.
 */
export function isPrivateHost(host: string): boolean {
  let lower = host.toLowerCase().trim();
  // Strip surrounding brackets from IPv6 literals: "[::]" → "::".
  if (lower.startsWith("[") && lower.endsWith("]")) {
    lower = lower.slice(1, -1);
  }

  // Hostname literals.
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "localhost.localdomain") return true;
  if (lower === "metadata.google.internal") return true;
  if (lower === "metadata" || lower.startsWith("metadata.")) return true;
  if (lower === "instance-data") return true; // AWS legacy alias
  if (lower === "100-100-100-200.aliyuncs.com") return true; // Alibaba IMDS hostname form

  // IPv6 literal — match before IPv4 numeric parsing.
  if (lower === "::" || lower === "::1") return true;
  if (lower === "0:0:0:0:0:0:0:0" || lower === "0:0:0:0:0:0:0:1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
  // IPv4-mapped IPv6: ::ffff:127.0.0.1 etc.
  const mapped = lower.match(/^::ffff:([0-9a-fx.]+)$/);
  if (mapped && isPrivateIPv4(mapped[1])) return true;

  // IPv4 in any numeric notation.
  if (isPrivateIPv4(lower)) return true;

  return false;
}

/**
 * Parse an IPv4 literal in dotted-decimal, dotted-octal (0177.0.0.1),
 * dotted-hex (0x7f.0.0.1), or single 32-bit int (2130706433) notation,
 * then test against private/reserved ranges. Returns false when the
 * input does not parse as IPv4 (typically a hostname).
 */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  let int32: number | null = null;

  if (parts.length === 4) {
    const octets: number[] = [];
    for (const p of parts) {
      let n: number;
      if (/^0x[0-9a-f]+$/.test(p)) n = parseInt(p, 16);
      else if (/^0[0-7]+$/.test(p) && p !== "0") n = parseInt(p, 8);
      else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10);
      else return false;
      if (Number.isNaN(n) || n < 0 || n > 255) return false;
      octets.push(n);
    }
    int32 = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  } else if (parts.length === 1) {
    if (/^0x[0-9a-f]+$/.test(host)) int32 = parseInt(host, 16);
    else if (/^0[0-7]+$/.test(host)) int32 = parseInt(host, 8);
    else if (/^[0-9]+$/.test(host)) int32 = parseInt(host, 10);
    if (int32 === null || Number.isNaN(int32) || int32 < 0 || int32 > 0xffffffff) return false;
    int32 >>>= 0;
  } else {
    return false;
  }

  const ranges: Array<[number, number]> = [
    [0x00000000, 0x00ffffff], // 0.0.0.0/8 (this host)
    [0x0a000000, 0x0affffff], // 10.0.0.0/8
    [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
    [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local + AWS/Azure IMDS)
    [0x646464c8, 0x646464c8], // 100.100.100.200/32 (Alibaba Cloud IMDS)
    [0xac100000, 0xac1fffff], // 172.16.0.0/12
    [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
    [0xe0000000, 0xefffffff], // 224.0.0.0/4 (multicast)
    [0xf0000000, 0xffffffff], // 240.0.0.0/4 (reserved) + 255.255.255.255
  ];
  for (const [lo, hi] of ranges) {
    if (int32 >= lo && int32 <= hi) return true;
  }
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
