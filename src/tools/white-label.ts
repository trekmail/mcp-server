import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

const assignableRole = z.enum([
  "client",
  "webmail_only",
  "domain_admin",
  "mailbox_operator",
  "read_only",
  "custom",
]);

// The list endpoint can also filter owner rows and retired roles that remain
// readable for audit/history. Invitation and update inputs stay restricted to
// the smaller product-supported set above.
const membershipRole = z.enum([
  "owner",
  "account_manager",
  "domain_admin",
  "client",
  "webmail_only",
  "mailbox_operator",
  "support_agent",
  "billing_manager",
  "read_only",
  "custom",
]);

const memberId = z.number().int().positive().describe("White Label member ID");
const domainIds = z
  .array(z.number().int().positive())
  .max(500)
  .optional()
  .describe("Domain IDs this person may reach");
const permissions = z
  .array(z.string().min(1).max(100))
  .max(200)
  .optional()
  .describe("Permissions for role=custom; read the access catalog first");
const idem = z.string().max(255).optional().describe("Optional idempotency key");
const clientLimitId = z.number().int().positive().describe("Client storage limit ID from list_client_limits");
// client_limits.storage_limit_mb is a PostgreSQL integer; the API caps it there.
const storageLimitMb = z
  .number()
  .int()
  .min(1)
  .max(2147483647)
  .describe("The budget in MB for mail and Drive in these domains, e.g. 51200 for 50 GB");
const limitDomainIds = z
  .array(z.number().int().positive())
  .min(1)
  .max(500)
  .describe("Domain IDs of this account");

export function registerWhiteLabelTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  const destructiveDisabled = (verb: string) => errorResult(
    `White Label changes are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to ${verb}.`,
  );
  const sendingDisabled = (verb: string) => errorResult(
    `Sending is disabled. Set TREKMAIL_ALLOW_SENDING=true to ${verb}.`,
  );

  server.registerTool(
    "get_white_label",
    {
      title: "Get White Label Status",
      description:
        "See whether White Label is active or in read-only grace, the default brand, setup progress, and the status of every reachable branded domain.",
      inputSchema: {},
    },
    async () => callApi(() => client.getWhiteLabel()),
  );

  server.registerTool(
    "get_white_label_access_catalog",
    {
      title: "Get White Label Access Catalog",
      description:
        "List the roles, custom permissions, and domains this connection may grant. Read this before inviting or changing a team member.",
      inputSchema: {},
    },
    async () => callApi(() => client.getWhiteLabelAccessCatalog()),
  );

  server.registerTool(
    "list_white_label_members",
    {
      title: "List White Label Members",
      description:
        "List clients and team members with their roles, domain access, status, and allowed next actions. Owner rows are visible but cannot be changed here.",
      inputSchema: {
        search: z.string().max(255).optional().describe("Search by name or email"),
        role: membershipRole.optional().describe("Filter by current or historical role"),
        status: z
          .enum(["pending", "active", "suspended", "revoked"])
          .optional()
          .describe("Filter by membership status"),
        include_removed: z.boolean().optional().describe("Include removed memberships"),
        page: z.number().int().positive().optional().describe("Page number"),
        per_page: z.number().int().min(1).max(100).optional().describe("Results per page"),
      },
    },
    async (args) => callApi(() => client.listWhiteLabelMembers(args)),
  );

  server.registerTool(
    "get_white_label_member",
    {
      title: "Get White Label Member",
      description:
        "Get one client or team member, including effective permissions, domain access, status, and the operations allowed in that state.",
      inputSchema: { member_id: memberId },
    },
    async ({ member_id }) => callApi(() => client.getWhiteLabelMember(member_id)),
  );

  server.registerTool(
    "invite_white_label_member",
    {
      title: "Invite White Label Member",
      description:
        "Invite a client or teammate to the branded dashboard. Domain-scoped roles need at least one domain. A custom role needs permissions from get_white_label_access_catalog. Returns the delivery result and one-time invitation URL.",
      inputSchema: {
        email: z.string().email().max(255).describe("Email address to invite"),
        role: assignableRole,
        all_domains: z.boolean().describe("Whether access follows every account domain"),
        domain_ids: domainIds,
        permissions,
        note: z.string().max(120).nullable().optional().describe("Private member note"),
        idempotency_key: idem,
      },
    },
    async ({ idempotency_key, ...body }) => {
      if (!config.allowSending) return sendingDisabled("send a member invitation");
      const key = idempotencyKey("invite_white_label_member", body, idempotency_key);
      return callApi(() => client.inviteWhiteLabelMember(body, key));
    },
  );

  server.registerTool(
    "update_white_label_member",
    {
      title: "Update White Label Member",
      description:
        "Change a member's role, domains, custom permissions, or note. Omitted fields stay unchanged. Use the access catalog first; the connection cannot grant permissions broader than its own.",
      inputSchema: {
        member_id: memberId,
        role: assignableRole.optional(),
        all_domains: z.boolean().optional(),
        domain_ids: domainIds,
        permissions,
        note: z.string().max(120).nullable().optional(),
        idempotency_key: idem,
      },
      annotations: { destructiveHint: true },
    },
    async ({ member_id, idempotency_key, ...body }) => {
      if (!config.allowDestructive) return destructiveDisabled("change member access");
      if (Object.values(body).every((value) => value === undefined)) {
        return errorResult("No member changes were provided.");
      }
      const key = idempotencyKey(
        "update_white_label_member",
        { member_id, ...body },
        idempotency_key,
      );
      return callApi(() => client.updateWhiteLabelMember(member_id, body, key));
    },
  );

  server.registerTool(
    "suspend_white_label_member",
    {
      title: "Suspend White Label Member",
      description:
        "Temporarily stop a member's access and revoke the API and mailbox keys they created. Read the member first to confirm suspend is allowed.",
      inputSchema: { member_id: memberId, idempotency_key: idem },
      annotations: { destructiveHint: true },
    },
    async ({ member_id, idempotency_key }) => {
      if (!config.allowDestructive) return destructiveDisabled("suspend a member");
      const key = idempotencyKey("suspend_white_label_member", { member_id }, idempotency_key);
      return callApi(() => client.suspendWhiteLabelMember(member_id, key));
    },
  );

  server.registerTool(
    "resume_white_label_member",
    {
      title: "Resume White Label Member",
      description:
        "Restore a suspended membership. Previously revoked API and mailbox keys stay revoked.",
      inputSchema: { member_id: memberId, idempotency_key: idem },
      annotations: { destructiveHint: true },
    },
    async ({ member_id, idempotency_key }) => {
      if (!config.allowDestructive) return destructiveDisabled("resume a member");
      const key = idempotencyKey("resume_white_label_member", { member_id }, idempotency_key);
      return callApi(() => client.resumeWhiteLabelMember(member_id, key));
    },
  );

  server.registerTool(
    "resend_white_label_invitation",
    {
      title: "Resend White Label Invitation",
      description:
        "Replace a pending member's old invitation with a new one, email it, and return the new one-time URL. Only pending invitations can be resent.",
      inputSchema: { member_id: memberId, idempotency_key: idem },
    },
    async ({ member_id, idempotency_key }) => {
      if (!config.allowSending) return sendingDisabled("resend a member invitation");
      const key = idempotencyKey(
        "resend_white_label_invitation",
        { member_id },
        idempotency_key,
      );
      return callApi(() => client.resendWhiteLabelInvitation(member_id, key));
    },
  );

  server.registerTool(
    "remove_white_label_member",
    {
      title: "Remove White Label Member",
      description:
        "Remove a member and revoke the API and mailbox keys they created. The membership can be restored later, but old keys never return.",
      inputSchema: {
        member_id: memberId,
        confirm_remove: z.boolean().describe("Must be true after reviewing the member"),
        idempotency_key: idem,
      },
      annotations: { destructiveHint: true },
    },
    async ({ member_id, confirm_remove, idempotency_key }) => {
      if (!config.allowDestructive) return destructiveDisabled("remove a member");
      if (!confirm_remove) return errorResult("Removal not confirmed. Set confirm_remove=true.");
      const key = idempotencyKey("remove_white_label_member", { member_id }, idempotency_key);
      return callApi(() => client.removeWhiteLabelMember(member_id, key));
    },
  );

  server.registerTool(
    "restore_white_label_member",
    {
      title: "Restore White Label Member",
      description:
        "Restore a removed membership. Accepted members return active; unaccepted invitations return pending. Old credentials remain revoked.",
      inputSchema: { member_id: memberId, idempotency_key: idem },
      annotations: { destructiveHint: true },
    },
    async ({ member_id, idempotency_key }) => {
      if (!config.allowDestructive) return destructiveDisabled("restore a member");
      const key = idempotencyKey("restore_white_label_member", { member_id }, idempotency_key);
      return callApi(() => client.restoreWhiteLabelMember(member_id, key));
    },
  );

  server.registerTool(
    "list_white_label_activity",
    {
      title: "List White Label Activity",
      description:
        "Read the account's White Label access history: invitations, role and domain changes, suspensions, removals, restores, and related security actions.",
      inputSchema: {
        action: z.string().max(64).optional().describe("Filter by exact action name"),
        member_id: memberId.optional().describe("Show activity involving one member"),
        page: z.number().int().positive().optional(),
        per_page: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) => callApi(() => client.listWhiteLabelActivity(args)),
  );

  server.registerTool(
    "get_white_label_member_activity",
    {
      title: "Get White Label Member Activity",
      description:
        "Read one member's recent account actions and sign-ins, including time, approximate location, browser, operating system, and device type.",
      inputSchema: {
        member_id: memberId,
        limit: z.number().int().min(1).max(100).optional().describe("Rows per activity section"),
      },
    },
    async ({ member_id, limit }) => callApi(
      () => client.getWhiteLabelMemberActivity(member_id, limit),
    ),
  );

  server.registerTool(
    "list_client_limits",
    {
      title: "List Client Storage Limits",
      description:
        "List White Label client storage limits: each is one budget in MB for the mailboxes and Drive of a client's domains. Rows give id, storage_limit_mb, domain_ids, member_ids, allocated_mb (fixed mailbox sizes), pending_invites_mb (fixed sizes of open invites), pool_mb (left for shared storage) and used_bytes. A connection limited to some domains sees only their limits.",
      inputSchema: {
        page: z.number().int().positive().optional().describe("Page number"),
        per_page: z.number().int().min(1).max(100).optional().describe("Results per page"),
      },
    },
    async (args) => callApi(() => client.listClientLimits(args)),
  );

  server.registerTool(
    "set_client_limit",
    {
      title: "Set Client Storage Limit",
      description:
        "Give a client's domains one storage budget for their mailboxes and Drive, or change it. Read list_client_limits first. Without client_limit_id, pass domain_ids and storage_limit_mb: domains without a limit get a new one, or join and change the one limit the other given domains share; domains under two limits are refused. With client_limit_id, change its storage_limit_mb, its domain_ids (the full new set; domains left out go back to the account's storage), or both. A limit cannot go below what its domains reserve or store. Needs a connection that reaches every domain. Returns the limit.",
      inputSchema: {
        client_limit_id: clientLimitId
          .optional()
          .describe("Change this limit. Omit to choose the limit by domain_ids"),
        domain_ids: limitDomainIds
          .optional()
          .describe("Domain IDs the limit covers. With client_limit_id, the full new set"),
        storage_limit_mb: storageLimitMb.optional(),
        idempotency_key: idem,
      },
      annotations: { destructiveHint: true },
    },
    async ({ client_limit_id, domain_ids, storage_limit_mb, idempotency_key }) => {
      if (!config.allowDestructive) return destructiveDisabled("change a client storage limit");

      if (client_limit_id === undefined) {
        if (domain_ids === undefined || storage_limit_mb === undefined) {
          return errorResult(
            "Pass domain_ids and storage_limit_mb, or client_limit_id with the fields to change.",
          );
        }
        const body = { domain_ids, storage_limit_mb };
        const key = idempotencyKey("set_client_limit", body, idempotency_key);
        return callApi(() => client.setClientLimit(body, key));
      }

      if (domain_ids === undefined && storage_limit_mb === undefined) {
        return errorResult("No client storage limit changes were provided.");
      }
      const changes = {
        ...(storage_limit_mb !== undefined ? { storage_limit_mb } : {}),
        ...(domain_ids !== undefined ? { domain_ids } : {}),
      };
      const key = idempotencyKey(
        "set_client_limit",
        { client_limit_id, ...changes },
        idempotency_key,
      );
      return callApi(() => client.updateClientLimit(client_limit_id, changes, key));
    },
  );

  server.registerTool(
    "remove_client_limit",
    {
      title: "Remove Client Storage Limit",
      description:
        "Remove a client storage limit. Its domains go back to the account's storage; mailboxes keep their sizes and nothing is deleted. Needs a connection that reaches every domain of the account. Returns the domain_ids that went back.",
      inputSchema: {
        client_limit_id: clientLimitId,
        confirm_remove: z.boolean().describe("Must be true after reviewing the limit"),
        idempotency_key: idem,
      },
      annotations: { destructiveHint: true },
    },
    async ({ client_limit_id, confirm_remove, idempotency_key }) => {
      if (!config.allowDestructive) return destructiveDisabled("remove a client storage limit");
      if (!confirm_remove) return errorResult("Removal not confirmed. Set confirm_remove=true.");
      const key = idempotencyKey("remove_client_limit", { client_limit_id }, idempotency_key);
      return callApi(() => client.removeClientLimit(client_limit_id, key));
    },
  );
}
