import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../../src/client.js";
import type { Config } from "../../src/config.js";
import { registerRulesTools } from "../../src/tools/rules.js";

type Registered = { inputSchema: z.ZodRawShape; handler: (input: unknown) => Promise<unknown> };

function register(client: Partial<TrekMailClient>) {
  const tools = new Map<string, Registered>();
  const server = {
    registerTool: (name: string, definition: { inputSchema: z.ZodRawShape }, handler: Registered["handler"]) => {
      tools.set(name, { inputSchema: definition.inputSchema, handler });
    },
  } as unknown as McpServer;
  registerRulesTools(server, client as TrekMailClient, { allowDestructive: true } as Config);

  return tools;
}

/**
 * A filter as the API returns it has to be a filter the update tool accepts:
 * an agent changes one condition and sends the rest back as it got it. Until
 * 1.19.2 the schema refused three things the API returns (ticket 584 review):
 * the `mark_read` action, a null `value` (every `exists` condition and every
 * action without one) and a null `header_name`.
 */
describe("mail filter tools take back what the API returns", () => {
  const stored = {
    name: "From the dashboard",
    match_type: "all",
    conditions: [
      { field: "header", operator: "exists", value: null, header_name: "List-Unsubscribe" },
      { field: "subject", operator: "regex", value: "^(re|fwd): invoice", header_name: null },
      { field: "size", operator: "over", value: "10240", header_name: null },
    ],
    actions: [{ type: "mark_read", value: null }, { type: "fileinto", value: "Bulk" }],
    stop: false,
    enabled: true,
  };

  it("update_mail_rule accepts it and passes it on unchanged", async () => {
    const updateMailRule = vi.fn().mockResolvedValue({ id: 7 });
    const tool = register({ updateMailRule }).get("update_mail_rule")!;

    const parsed = z.object(tool.inputSchema).safeParse({ mailbox_id: 10, rule_id: 7, ...stored });
    expect(parsed.error?.issues ?? []).toEqual([]);

    await tool.handler(parsed.data);
    expect(updateMailRule).toHaveBeenCalledTimes(1);
    const body = updateMailRule.mock.calls[0].find((argument) => typeof argument === "object" && argument !== null && "conditions" in argument);
    expect(body.conditions).toEqual(stored.conditions);
    expect(body.actions).toEqual(stored.actions);
  });

  it("create_mail_rule accepts the same conditions and actions", () => {
    const tool = register({}).get("create_mail_rule")!;

    expect(z.object(tool.inputSchema).safeParse({ mailbox_id: 10, ...stored }).success).toBe(true);
  });

  it("still refuses an operator or an action the API does not know", () => {
    const schema = z.object(register({}).get("create_mail_rule")!.inputSchema);
    const base = { mailbox_id: 10, match_type: "all" };

    expect(schema.safeParse({ ...base, conditions: [{ field: "subject", operator: "like", value: "x" }], actions: [{ type: "discard" }] }).success).toBe(false);
    expect(schema.safeParse({ ...base, conditions: [{ field: "subject", operator: "is", value: "x" }], actions: [{ type: "archive" }] }).success).toBe(false);
  });
});
