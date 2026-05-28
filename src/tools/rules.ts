import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

const conditionSchema = z.object({
  field: z.enum(["from", "to", "subject", "body", "header", "size"]),
  operator: z.enum(["is", "contains", "matches", "over", "under", "exists"]),
  value: z.string().max(500).optional(),
  header_name: z.string().max(100).optional(),
});

const actionSchema = z.object({
  type: z.enum([
    "fileinto",
    "redirect_copy",
    "redirect",
    "addflag",
    "discard",
    "reject",
  ]),
  value: z.string().max(500).optional(),
});

export function registerRulesTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  server.registerTool(
    "list_mail_rules",
    {
      title: "List Mail Filters",
      description:
        "List all mail filters for a mailbox. Filters automatically process incoming email — forward by sender/subject/content, sort into folders, flag, or discard. Pro and Agency plans only.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
      },
    },
    async ({ mailbox_id }) => {
      return callApi(() => client.listMailRules(mailbox_id));
    },
  );

  server.registerTool(
    "get_mail_rule",
    {
      title: "Get Mail Filter",
      description: "Get a single mail filter by ID.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
        rule_id: z
          .number()
          .int()
          .positive()
          .describe("The filter ID"),
      },
    },
    async ({ mailbox_id, rule_id }) => {
      return callApi(() => client.getMailRule(mailbox_id, rule_id));
    },
  );

  server.registerTool(
    "create_mail_rule",
    {
      title: "Create Mail Filter",
      description:
        "Create a new mail filter for a mailbox. Filters automatically process incoming email based on conditions (sender, subject, body, size) and perform actions (move to folder, forward, flag, discard, reject). Pro and Agency plans only.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
        name: z
          .string()
          .max(255)
          .optional()
          .describe("Human-readable filter name"),
        match_type: z
          .enum(["all", "any"])
          .default("all")
          .describe("'all' = all conditions must match (AND), 'any' = any condition can match (OR)"),
        conditions: z
          .array(conditionSchema)
          .min(1)
          .max(10)
          .describe("Conditions to match incoming email against"),
        actions: z
          .array(actionSchema)
          .min(1)
          .max(5)
          .describe("Actions to perform when conditions match"),
        stop: z
          .boolean()
          .default(false)
          .describe("Stop processing further filters after this one matches"),
        enabled: z.boolean().default(true).describe("Whether the filter is active"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async (inputs) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to create mail filters.");
      }
      const idemKey = idempotencyKey(
        "create_mail_rule",
        { mailbox_id: inputs.mailbox_id, name: inputs.name, conditions: inputs.conditions, actions: inputs.actions },
        inputs.idempotency_key,
      );
      return callApi(() =>
        client.createMailRule(
          inputs.mailbox_id,
          {
            name: inputs.name,
            match_type: inputs.match_type,
            conditions: inputs.conditions,
            actions: inputs.actions,
            stop: inputs.stop,
            enabled: inputs.enabled,
          },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "update_mail_rule",
    {
      title: "Update Mail Filter",
      description: "Update an existing mail filter. Pro and Agency plans only.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID"),
        rule_id: z
          .number()
          .int()
          .positive()
          .describe("The filter ID to update"),
        name: z.string().max(255).optional().describe("Filter name"),
        match_type: z.enum(["all", "any"]).default("all").describe("Match type"),
        conditions: z.array(conditionSchema).min(1).max(10).describe("Updated conditions"),
        actions: z.array(actionSchema).min(1).max(5).describe("Updated actions"),
        stop: z.boolean().optional().describe("Stop after match"),
        enabled: z.boolean().optional().describe("Whether filter is active"),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async (inputs) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to update mail filters.");
      }
      const idemKey = idempotencyKey(
        "update_mail_rule",
        { mailbox_id: inputs.mailbox_id, rule_id: inputs.rule_id },
        inputs.idempotency_key,
      );
      return callApi(() =>
        client.updateMailRule(
          inputs.mailbox_id,
          inputs.rule_id,
          {
            name: inputs.name,
            match_type: inputs.match_type,
            conditions: inputs.conditions,
            actions: inputs.actions,
            stop: inputs.stop,
            enabled: inputs.enabled,
          },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "delete_mail_rule",
    {
      title: "Delete Mail Filter",
      description:
        "Delete a mail filter. This is irreversible. Requires TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        mailbox_id: z.number().int().positive().describe("The mailbox ID"),
        rule_id: z.number().int().positive().describe("The filter ID to delete"),
        confirm_delete: z
          .boolean()
          .describe("Must be true to confirm deletion"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, rule_id, confirm_delete }) => {
      if (!config.allowDestructive) {
        return errorResult(
          "Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to enable filter deletion.",
        );
      }
      if (!confirm_delete) {
        return errorResult(
          "confirm_delete must be true to delete a filter. This action is irreversible.",
        );
      }
      return callApi(() => client.deleteMailRule(mailbox_id, rule_id));
    },
  );

  server.registerTool(
    "reorder_mail_rules",
    {
      title: "Reorder Mail Filters",
      description:
        "Change the execution order of mail filters. Filters are checked in order — first match wins.",
      inputSchema: {
        mailbox_id: z.number().int().positive().describe("The mailbox ID"),
        order: z
          .array(z.number().int().positive())
          .describe("Array of filter IDs in the desired execution order"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, order }) => {
      if (!config.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to reorder mail filters.");
      }
      return callApi(() => client.reorderMailRules(mailbox_id, order));
    },
  );
}
