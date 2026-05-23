import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

/**
 * Drive Sync Devices (added 2026-05-23 alongside REST `/api/v1/drive/devices`).
 *
 * Long-lived `dsync_` credentials used by external sync clients (rclone,
 * Cyberduck, X-Plore, DAVx⁵, Documents by Readdle, FolderSync) to mount
 * TrekMail Drive over WebDAV. These tools let an agent provision /
 * inventory / revoke / rotate those credentials.
 *
 * Plaintext password is returned by `drive_device_create` and
 * `drive_device_rotate` exactly once — never re-derivable, never stored
 * server-side beyond the SHA-256 hash. Agents should hand it to the
 * caller immediately and not echo it in subsequent tool calls.
 *
 * `drive_device_revoke` and `drive_device_rotate` are gated behind
 * `TREKMAIL_ALLOW_DESTRUCTIVE=true` because revoking a device password
 * out from under a running sync client will silently brick its access
 * — the same safety gate the Drive trash/purge tools use.
 */
export function registerDriveDeviceTools(
  server: McpServer,
  client: TrekMailClient,
  config?: { allowDestructive?: boolean },
): void {
  const requireDestructive = (action: string) => {
    if (!config?.allowDestructive) {
      return errorResult(
        `Drive device ${action} is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in the MCP environment to enable revoke / rotate.`,
      );
    }
    return null;
  };

  server.registerTool(
    "drive_device_list",
    {
      title: "List Drive Sync Devices",
      description:
        "List active and revoked Drive sync-device passwords for the account. Returns id, label, scopes, mailbox binding, created_via (dashboard/webmail/api), created_at, last_used_at, expires_at, revoked_at, is_active. Never returns the plaintext password or its hash. Token mailbox_ids constraint is honored — a mailbox-bound token sees only its own mailbox's devices.",
      inputSchema: {},
    },
    async () => callApi(() => client.listDriveDevices()),
  );

  server.registerTool(
    "drive_device_create",
    {
      title: "Create Drive Sync Device Password",
      description:
        "Mint a new Drive sync-device password (a `dsync_…` credential) usable by rclone, Cyberduck, X-Plore, DAVx⁵, Documents, FolderSync, etc. The plaintext password is returned in the response under data.password — show it to the user once and tell them to store it now; it can never be recovered. Use a descriptive label like 'MacBook rclone' or 'iPhone Documents'. Scopes must intersect what the account's plan allows; mailbox-scoped passwords also require mailbox_id. expires_in_days is optional — omit for a non-expiring credential. Per-account cap: 1000 active+revoked rows. Rate-limited 20/hour per account.",
      inputSchema: {
        label: z
          .string()
          .min(1)
          .max(64)
          .describe("Human-readable label (e.g. 'MacBook rclone', 'NAS backup')"),
        scopes: z
          .array(
            z.enum([
              "drive:account:read",
              "drive:account:write",
              "drive:account:share",
              "drive:account:purge",
              "drive:mailbox:read",
              "drive:mailbox:write",
              "drive:mailbox:share",
              "drive:mailbox:purge",
            ]),
          )
          .min(1)
          .describe("File-access scopes the device password may use. Will be intersected with what the account's plan allows."),
        mailbox_id: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe("Bind the password to a specific mailbox's Drive (omit / null for account-wide). Mailbox-constrained tokens cannot omit this."),
        expires_in_days: z
          .number()
          .int()
          .min(1)
          .max(3650)
          .nullable()
          .optional()
          .describe("Optional expiry window in days. Omit / null = never expires."),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional client-supplied idempotency key. Otherwise derived from {label, scopes, mailbox_id}."),
      },
      annotations: { destructiveHint: false },
    },
    async ({ label, scopes, mailbox_id, expires_in_days, idempotency_key }) => {
      const idemKey = idempotencyKey(
        "drive_device_create",
        { label, scopes: scopes.slice().sort().join(","), mailbox_id: mailbox_id ?? null },
        idempotency_key,
      );
      return callApi(() =>
        client.createDriveDevice(
          {
            label,
            scopes,
            mailbox_id: mailbox_id ?? null,
            expires_in_days: expires_in_days ?? null,
          },
          idemKey,
        ),
      );
    },
  );

  server.registerTool(
    "drive_device_revoke",
    {
      title: "Revoke Drive Sync Device Password",
      description:
        "Permanently revoke a Drive sync-device password. The sync client using it will lose access on its next request (no grace). Idempotent: revoking an already-revoked row is a no-op. Cannot be undone — to give the same client access again, create a fresh device password.",
      inputSchema: {
        device_id: z.number().int().positive().describe("The drive device row id"),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ device_id, idempotency_key }) => {
      const gated = requireDestructive("revoke");
      if (gated !== null) return gated;
      const idemKey = idempotencyKey(
        "drive_device_revoke",
        { device_id },
        idempotency_key,
      );
      return callApi(() => client.revokeDriveDevice(device_id, idemKey));
    },
  );

  server.registerTool(
    "drive_device_rotate",
    {
      title: "Rotate Drive Sync Device Password",
      description:
        "Atomic credential rotation: revoke the old row and mint a new one inheriting label, scopes, and mailbox binding. The new plaintext password is returned in data.password (one-time). The old password stops working immediately. Optional expires_in_days overrides the inherited expiry — omit to keep the original window. Rate-limited 10/hour per account. Use this for scheduled credential rotation, NOT for changing scopes (revoke + create a new one for that).",
      inputSchema: {
        device_id: z.number().int().positive().describe("The drive device row id to rotate"),
        expires_in_days: z
          .number()
          .int()
          .min(1)
          .max(3650)
          .nullable()
          .optional()
          .describe("Optional new expiry window. Omit / null = inherit from the original row."),
        idempotency_key: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ device_id, expires_in_days, idempotency_key }) => {
      const gated = requireDestructive("rotate");
      if (gated !== null) return gated;
      const idemKey = idempotencyKey(
        "drive_device_rotate",
        { device_id, expires_in_days: expires_in_days ?? null },
        idempotency_key,
      );
      return callApi(() =>
        client.rotateDriveDevice(
          device_id,
          { expires_in_days: expires_in_days ?? null },
          idemKey,
        ),
      );
    },
  );
}
