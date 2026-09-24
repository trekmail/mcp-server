import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrekMailClient } from "../../src/client.js";
import type { Config } from "../../src/config.js";
import { registerCloudflareTools } from "../../src/tools/cloudflare.js";
import { registerDomainSmtpTools } from "../../src/tools/domain-smtp.js";
import { registerSmtpTools } from "../../src/tools/smtp.js";

function harness(client: TrekMailClient) {
  const tools = new Map<string, {
    schema: z.ZodObject<z.ZodRawShape>;
    handler: (input: Record<string, unknown>) => Promise<unknown>;
  }>();
  const server = {
    registerTool(name: string, definition: { inputSchema: z.ZodRawShape }, handler: (input: Record<string, unknown>) => Promise<unknown>) {
      tools.set(name, { schema: z.object(definition.inputSchema), handler });
    },
  } as unknown as McpServer;
  const config: Config = {
    baseUrl: "https://trekmail.test", apiToken: "tm_live_test", timeoutMs: 30_000,
    userAgent: "test", allowDestructive: true, allowSending: false, allowMigration: false,
  };
  registerCloudflareTools(server, client, config);
  registerDomainSmtpTools(server, client, config);
  registerSmtpTools(server, client, config);

  return async (name: string, input: Record<string, unknown>) => {
    const tool = tools.get(name)!;
    return tool.handler(tool.schema.parse(input));
  };
}

describe("SMTP and Cloudflare operation identities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each([
    ["update_smtp_config", "updateSmtpConfig", 1, { mode: "custom", host: "smtp.example.com", port: 587, encryption: "tls", username: "user", password: "old-secret" }, { password: "new-secret" }],
    ["test_smtp", "testSmtp", 1, { host: "smtp.example.com", port: 587, encryption: "tls", username: "user", password: "old-secret" }, { password: "new-secret" }],
    ["update_domain_smtp_profile", "updateDomainSmtpProfile", 3, { domain_id: 7, profile_id: 3, name: "Primary", host: "smtp.example.com", port: 587, encryption: "tls", username: "user", password: "old-secret" }, { password: "new-secret" }],
    ["test_domain_smtp", "testDomainSmtp", 2, { domain_id: 7, mode: "custom", host: "smtp.example.com", password: "old-secret" }, { password: "new-secret" }],
    ["connect_cloudflare_domains", "connectCloudflareDomains", 2, { api_token: "old-secret", selected: [{ zone_id: "z1", zone_name: "example.com", trekmail_domain_id: 7 }] }, { api_token: "new-secret" }],
    ["apply_cloudflare_dns", "applyCloudflareDns", 2, { domain_ids: [7], included_records: { "7": ["mx_primary"] } }, { included_records: { "7": ["spf_record"] } }],
  ] as const)("%s gives changed requests distinct identities and preserves explicit replay keys", async (tool, method, keyIndex, original, changes) => {
    const call = vi.fn().mockResolvedValue({ data: {} });
    const invoke = harness({ [method]: call } as unknown as TrekMailClient);
    await invoke(tool, original);
    await invoke(tool, { ...original, ...changes });
    const firstKey = call.mock.calls[0][keyIndex];
    const nextKey = call.mock.calls[1][keyIndex];
    expect(firstKey).not.toBe(nextKey);
    expect(firstKey).not.toContain("old-secret");
    expect(nextKey).not.toContain("new-secret");

    await invoke(tool, { ...original, idempotency_key: "retry-this-operation" });
    await invoke(tool, { ...original, idempotency_key: "retry-this-operation" });
    expect(call.mock.calls[2][keyIndex]).toBe("retry-this-operation");
    expect(call.mock.calls[3][keyIndex]).toBe("retry-this-operation");
  });

  it.each([undefined, null, 7])("connect accepts omitted, null, and numeric domain IDs (%s)", async (domainId) => {
    const call = vi.fn().mockResolvedValue({ data: {} });
    const invoke = harness({ connectCloudflareDomains: call } as unknown as TrekMailClient);
    const selected = [{ zone_id: "z1", zone_name: "example.com", ...(domainId === undefined ? {} : { trekmail_domain_id: domainId }) }];
    await invoke("connect_cloudflare_domains", { api_token: "token", selected });
    expect(call).toHaveBeenCalledWith("token", selected, expect.any(String));
  });

  it("reuses the generated operation key across a transport retry", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const invoke = harness(new TrekMailClient({
      baseUrl: "https://trekmail.test", token: "tm_live_test", timeoutMs: 30_000, userAgent: "test",
    }));

    const result = invoke("connect_cloudflare_domains", {
      api_token: "token", selected: [{ zone_id: "z1", zone_name: "example.com" }],
    });
    await vi.runAllTimersAsync();
    await result;

    expect(fetch).toHaveBeenCalledTimes(2);
    const key = (index: number) => (fetch.mock.calls[index][1].headers as Record<string, string>)["Idempotency-Key"];
    expect(key(0)).toBeTruthy();
    expect(key(1)).toBe(key(0));
  });
});
