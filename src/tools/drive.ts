import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { createReadStream, realpathSync, statSync } from "node:fs";
import { resolve as resolvePath, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { Readable } from "node:stream";
import type { TrekMailClient } from "../client.js";
import { callApi, errorResult } from "./util.js";

/**
 * Path-allowlist for `drive_file_upload` (ticket #170, 2026-05-28).
 *
 * Threat model: an attacker reaches the stdio MCP either by (a) directly
 * invoking the tool with a sensitive `local_path` after compromising an
 * agent's credentials, or (b) via prompt injection in an email body that
 * the user's agent reads and acts on. Both classes try to exfiltrate
 * `/proc/self/environ`, `~/.ssh/id_rsa`, `.env`, etc.
 *
 * Strategy (all checks run on `realpathSync` canonical form, so a
 * symlink dropped inside an allowed dir cannot point at a denied file):
 *   1. Hard denylist of sensitive system paths regardless of allowlist.
 *   2. Files literally named `.env` (or `.env.*`) rejected.
 *   3. Allowlist defaults to $HOME ∪ $TMPDIR. Operators can override via
 *      `TREKMAIL_UPLOAD_DIR` (colon-separated list).
 *
 * Not registered on HTTP transport at all (see `httpTransport` flag) —
 * "local file" semantics are meaningless server-side.
 */
function assertUploadPathAllowed(localPath: string): void {
  let real: string;
  try {
    real = realpathSync(resolvePath(localPath));
  } catch (e) {
    throw new Error(`Path does not exist or is unreadable: ${localPath}`);
  }

  const denyPrefixes = [
    "/proc",
    "/sys",
    "/dev",
    "/etc",
    "/root",
    "/boot",
    resolvePath(homedir(), ".ssh"),
    resolvePath(homedir(), ".aws"),
    resolvePath(homedir(), ".config", "gcloud"),
    resolvePath(homedir(), ".config", "rclone"),
    resolvePath(homedir(), ".docker"),
    resolvePath(homedir(), ".kube"),
    resolvePath(homedir(), ".gnupg"),
  ];
  for (const deny of denyPrefixes) {
    if (real === deny || real.startsWith(deny + sep)) {
      throw new Error(`Path is in a restricted location: ${localPath}`);
    }
  }

  const basename = real.split(sep).pop() ?? "";
  if (basename === ".env" || basename.startsWith(".env.")) {
    throw new Error(`Refusing to upload ${basename} (sensitive file)`);
  }

  const envOverride = process.env.TREKMAIL_UPLOAD_DIR;
  const allowed: string[] = envOverride
    ? envOverride.split(":").filter(Boolean).map((p) => realpathSync(resolvePath(p)))
    : [realpathSync(resolvePath(homedir())), realpathSync(resolvePath(tmpdir()))];

  const inAllowed = allowed.some(
    (a) => real === a || real.startsWith(a + sep),
  );
  if (!inAllowed) {
    throw new Error(
      `Path is outside the upload allowlist. Set TREKMAIL_UPLOAD_DIR (colon-separated) to an allowed directory, or move the file under one of: ${allowed.join(", ")}`,
    );
  }
}

/**
 * Drive API + MCP rollout, PR #8.
 *
 * Tools mirror /api/v1/drive/* surface from PR #4-#7. {space} accepts
 * "account" | "mailbox:N" | numeric DriveSpace id; the value is passed
 * straight through to the API which resolves and gates it via
 * EnforceDriveSpaceAccess.
 *
 * Pagination guard: list-style tools default per_page=50 with a
 * description note steering the agent to next_cursor instead of
 * cranking per_page. The API caps at 200 server-side regardless.
 */
export function registerDriveTools(
  server: McpServer,
  client: TrekMailClient,
  config?: { allowDestructive?: boolean; httpTransport?: boolean },
): void {
  // Audit finding #45: every other destructive MCP tool (mailbox delete,
  // password change, etc.) requires TREKMAIL_ALLOW_DESTRUCTIVE=true. The
  // Drive purge / empty-trash tools rely on the server-side :purge
  // scope alone, which is correct but inconsistent with the rest of the
  // safety model. Add the same gate so accidental MCP misconfiguration
  // can't trigger irreversible Drive deletes.
  const requireDestructive = (action: string) => {
    if (!config?.allowDestructive) {
      return errorResult(
        `Drive ${action} is disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true in the MCP environment to enable destructive Drive operations.`,
      );
    }
    return null;
  };

  // ─── Spaces / storage ─────────────────────────────────────────────

  server.registerTool(
    "drive_spaces_list",
    {
      title: "List Drive Spaces",
      description:
        'List Drive spaces this token can enumerate. Returns up to two kinds: "account_drive" (singleton, dashboard Drive) and "mailbox_personal" (one per mailbox). Token mailbox_ids constraint is honored. Empty data array means the token has no Drive scopes.',
      inputSchema: {},
    },
    async () => callApi(() => client.listDriveSpaces()),
  );

  server.registerTool(
    "drive_storage_summary",
    {
      title: "Drive Storage Summary",
      description:
        "Account-wide pool snapshot: used_bytes, limit_bytes, addon size, addon active/grace flags. Useful before initiating a large upload.",
      inputSchema: {},
    },
    async () => callApi(() => client.getDriveStorage()),
  );

  server.registerTool(
    "drive_space_usage",
    {
      title: "Drive Space Usage",
      description:
        "Per-space quota snapshot. Same numbers as storage_summary but tagged to the resolved space.",
      inputSchema: {
        space: z.string().describe("'account' | 'mailbox:N' | numeric space id"),
      },
    },
    async ({ space }) => callApi(() => client.getDriveSpaceUsage(space)),
  );

  // ─── Browse ───────────────────────────────────────────────────────

  server.registerTool(
    "drive_browse_folder",
    {
      title: "Browse Drive Folder",
      description:
        "List folders + files in one Drive folder (or root when folder_id is omitted). Cursor-paginated with an opaque next_cursor; default per_page=50, max 200. If the response has has_more=true, request the next page with the returned next_cursor — do not crank per_page.",
      inputSchema: {
        space: z.string().describe("'account' | 'mailbox:N' | numeric space id"),
        folder_id: z.number().int().positive().nullable().optional(),
        sort: z.enum(["name", "size", "date"]).optional(),
        dir: z.enum(["asc", "desc"]).optional(),
        per_page: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional().describe("Opaque pagination token returned by the previous response"),
      },
    },
    async ({ space, folder_id, sort, dir, per_page, cursor }) =>
      callApi(() =>
        client.listDriveFolder(space, folder_id ?? null, { sort, dir, per_page, cursor }),
      ),
  );

  server.registerTool(
    "drive_folder_tree",
    {
      title: "Drive Folder Tree",
      description:
        "Flat list of every folder in the space (id + name + parent_id + color). Useful for building a 'Move to' UI or computing paths client-side.",
      inputSchema: {
        space: z.string(),
      },
    },
    async ({ space }) => callApi(() => client.getDriveFolderTree(space)),
  );

  server.registerTool(
    "drive_select_all_ids",
    {
      title: "Drive Select-All IDs",
      description:
        "Returns every file_id and folder_id directly inside the named folder (root when folder_id omitted). Capped at 5000 items — paginate via drive_browse_folder for larger folders.",
      inputSchema: {
        space: z.string(),
        folder_id: z.number().int().positive().nullable().optional(),
      },
    },
    async ({ space, folder_id }) => callApi(() => client.getDriveAllIds(space, folder_id ?? null)),
  );

  // ─── Files ────────────────────────────────────────────────────────

  server.registerTool(
    "drive_file_get",
    {
      title: "Get Drive File Metadata",
      description:
        "File metadata: name, size, mime, status, scan status, has_active_share_link.",
      inputSchema: { file_id: z.number().int().positive() },
    },
    async ({ file_id }) => callApi(() => client.getDriveFile(file_id)),
  );

  server.registerTool(
    "drive_file_download_url",
    {
      title: "Get Drive File Download URL",
      description:
        "Returns a short-lived presigned URL (default ~5min) you can fetch directly to download the file bytes. URL forces attachment disposition. Does NOT stream bytes through MCP.",
      inputSchema: { file_id: z.number().int().positive() },
    },
    async ({ file_id }) => callApi(() => client.getDriveFileDownload(file_id)),
  );

  server.registerTool(
    "drive_file_rename",
    {
      title: "Rename Drive File",
      description: "Rename a file. Validation: name passes the DriveItemName ruleset.",
      inputSchema: {
        file_id: z.number().int().positive(),
        name: z.string().min(1).max(255),
      },
      annotations: { destructiveHint: true },
    },
    async ({ file_id, name }) => {
      const blocked = requireDestructive("file rename");
      if (blocked) return blocked;
      return callApi(() => client.renameDriveFile(file_id, name));
    },
  );

  server.registerTool(
    "drive_file_move",
    {
      title: "Move Drive File",
      description: "Move a file to a different folder (folder_id=null moves to root).",
      inputSchema: {
        file_id: z.number().int().positive(),
        folder_id: z.number().int().positive().nullable(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ file_id, folder_id }) => {
      const blocked = requireDestructive("file move");
      if (blocked) return blocked;
      return callApi(() => client.moveDriveFile(file_id, folder_id, randomUUID()));
    },
  );

  server.registerTool(
    "drive_file_trash",
    {
      title: "Trash Drive File",
      description: "Soft-delete: file moves to trash and active share-links are revoked.",
      inputSchema: { file_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ file_id }) => {
      const blocked = requireDestructive("file trash");
      if (blocked) return blocked;
      return callApi(() => client.trashDriveFile(file_id));
    },
  );

  server.registerTool(
    "drive_file_restore",
    {
      title: "Restore Drive File",
      description: "Un-trash a soft-deleted file. If parent folder is also trashed, file pops up at root.",
      inputSchema: { file_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ file_id }) => {
      const blocked = requireDestructive("file restore");
      if (blocked) return blocked;
      return callApi(() => client.restoreDriveFile(file_id, randomUUID()));
    },
  );

  server.registerTool(
    "drive_file_purge",
    {
      title: "Permanently Delete Drive File",
      description:
        "DESTRUCTIVE. Permanently delete a TRASHED file. Bypasses the trash safety net. Requires drive:*:purge scope AND TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: { file_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ file_id }) => {
      const blocked = requireDestructive("file purge");
      if (blocked) return blocked;
      return callApi(() => client.purgeDriveFile(file_id));
    },
  );

  // ─── Folders ──────────────────────────────────────────────────────

  server.registerTool(
    "drive_folder_create",
    {
      title: "Create Drive Folder",
      description:
        "Create a folder inside the space. parent_id=null creates at root. color is HEX (#RRGGBB); omitted = default slate gray. is_shared=true makes it visible to every mailbox in the account immediately (must be top-level — parent_id must be null when is_shared is true).",
      inputSchema: {
        space: z.string(),
        name: z.string().min(1).max(255),
        parent_id: z.number().int().positive().nullable().optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        is_shared: z.boolean().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ space, name, parent_id, color, is_shared }) => {
      const blocked = requireDestructive("folder create");
      if (blocked) return blocked;
      return callApi(() => client.createDriveFolder(space, name, parent_id ?? null, color, is_shared, randomUUID()));
    },
  );

  server.registerTool(
    "drive_folder_update",
    {
      title: "Rename / Recolor Drive Folder",
      description: "Update name and/or color. At least one must be set; both are optional independently.",
      inputSchema: {
        folder_id: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ folder_id, name, color }) => {
      const blocked = requireDestructive("folder update");
      if (blocked) return blocked;
      const changes: { name?: string; color?: string | null } = {};
      if (name !== undefined) changes.name = name;
      if (color !== undefined) changes.color = color;
      return callApi(() => client.updateDriveFolder(folder_id, changes));
    },
  );

  server.registerTool(
    "drive_folder_move",
    {
      title: "Move Drive Folder",
      description: "Re-parent a folder. parent_id=null moves to root. Cycle detection enforced server-side.",
      inputSchema: {
        folder_id: z.number().int().positive(),
        parent_id: z.number().int().positive().nullable(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ folder_id, parent_id }) => {
      const blocked = requireDestructive("folder move");
      if (blocked) return blocked;
      return callApi(() => client.moveDriveFolder(folder_id, parent_id, randomUUID()));
    },
  );

  server.registerTool(
    "drive_folder_trash",
    {
      title: "Trash Drive Folder",
      description: "Soft-delete folder + entire subtree (cascade). Active share-links on contained files are revoked.",
      inputSchema: { folder_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ folder_id }) => {
      const blocked = requireDestructive("folder trash");
      if (blocked) return blocked;
      return callApi(() => client.trashDriveFolder(folder_id));
    },
  );

  server.registerTool(
    "drive_folder_restore",
    {
      title: "Restore Drive Folder",
      description: "Restore a trashed folder + everything that was deleted in the same operation.",
      inputSchema: { folder_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ folder_id }) => {
      const blocked = requireDestructive("folder restore");
      if (blocked) return blocked;
      return callApi(() => client.restoreDriveFolder(folder_id, randomUUID()));
    },
  );

  server.registerTool(
    "drive_folder_purge",
    {
      title: "Permanently Delete Drive Folder",
      description:
        "DESTRUCTIVE. Hard-delete a TRASHED folder + its entire subtree. B2 cleanup runs async. Requires drive:*:purge scope AND TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: { folder_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ folder_id }) => {
      const blocked = requireDestructive("folder purge");
      if (blocked) return blocked;
      return callApi(() => client.purgeDriveFolder(folder_id));
    },
  );

  server.registerTool(
    "drive_folder_share_with_account",
    {
      title: "Share Drive Folder with the Account",
      description:
        "Make this folder visible to every mailbox in the account. If the folder lives in a mailbox-personal Drive, the entire subtree (folders + files) is migrated to account-drive in one transaction; quota counters move from mailbox to account. Restrictions: folder must be top-level (parent_id=null); subtree must contain ≤ 1000 files; account pool must have room for the migrated bytes. Idempotent — calling on an already-shared folder returns it unchanged.",
      inputSchema: { folder_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ folder_id }) => {
      const blocked = requireDestructive("folder share-with-account");
      if (blocked) return blocked;
      return callApi(() => client.shareDriveFolderWithAccount(folder_id, randomUUID()));
    },
  );

  server.registerTool(
    "drive_folder_stop_sharing",
    {
      title: "Stop Sharing Drive Folder",
      description:
        "Flip is_shared back to false on a shared folder. Folder stays in account-drive (no migration back to a specific mailbox); other mailboxes lose visibility, the dashboard owner keeps it as a private account-drive folder. Idempotent on already-private folders.",
      inputSchema: { folder_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ folder_id }) => {
      const blocked = requireDestructive("folder stop-sharing");
      if (blocked) return blocked;
      return callApi(() => client.stopSharingDriveFolder(folder_id, randomUUID()));
    },
  );

  // ─── Trash ────────────────────────────────────────────────────────

  server.registerTool(
    "drive_trash_list",
    {
      title: "List Drive Trash",
      description:
        "Soft-deleted files + folders in the space, newest-first. Cursor-paginated by deleted_at; default per_page=50.",
      inputSchema: {
        space: z.string(),
        per_page: z.number().int().min(1).max(200).optional(),
        cursor: z.string().optional().describe("Opaque pagination token returned by the previous response"),
      },
    },
    async ({ space, per_page, cursor }) => callApi(() => client.listDriveTrash(space, { per_page, cursor })),
  );

  server.registerTool(
    "drive_trash_empty",
    {
      title: "Empty Drive Trash",
      description:
        "DESTRUCTIVE. Permanently delete every trashed file + folder in the space. Requires drive:*:purge scope AND TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: { space: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ space }) => {
      const blocked = requireDestructive("trash empty");
      if (blocked) return blocked;
      return callApi(() => client.emptyDriveTrash(space));
    },
  );

  // ─── Bulk ─────────────────────────────────────────────────────────

  server.registerTool(
    "drive_bulk_trash",
    {
      title: "Bulk Trash Drive Items",
      description: "Soft-delete N items in one call. Caps at 5000 items per request.",
      inputSchema: {
        space: z.string(),
        file_ids: z.array(z.number().int().positive()).default([]),
        folder_ids: z.array(z.number().int().positive()).default([]),
      },
      annotations: { destructiveHint: true },
    },
    async ({ space, file_ids, folder_ids }) => {
      const blocked = requireDestructive("bulk trash");
      if (blocked) return blocked;
      return callApi(() => client.bulkDriveTrash(space, file_ids, folder_ids, randomUUID()));
    },
  );

  server.registerTool(
    "drive_bulk_restore",
    {
      title: "Bulk Restore Drive Items",
      description: "Restore N trashed items in one call.",
      inputSchema: {
        space: z.string(),
        file_ids: z.array(z.number().int().positive()).default([]),
        folder_ids: z.array(z.number().int().positive()).default([]),
      },
      annotations: { destructiveHint: true },
    },
    async ({ space, file_ids, folder_ids }) => {
      const blocked = requireDestructive("bulk restore");
      if (blocked) return blocked;
      return callApi(() => client.bulkDriveRestore(space, file_ids, folder_ids, randomUUID()));
    },
  );

  server.registerTool(
    "drive_bulk_move",
    {
      title: "Bulk Move Drive Items",
      description:
        "Re-parent N items to target_folder_id (null = root). Files use a single UPDATE; folders go one-by-one for cycle detection.",
      inputSchema: {
        space: z.string(),
        file_ids: z.array(z.number().int().positive()).default([]),
        folder_ids: z.array(z.number().int().positive()).default([]),
        target_folder_id: z.number().int().positive().nullable(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ space, file_ids, folder_ids, target_folder_id }) => {
      const blocked = requireDestructive("bulk move");
      if (blocked) return blocked;
      return callApi(() =>
        client.bulkDriveMove(space, file_ids, folder_ids, target_folder_id, randomUUID()),
      );
    },
  );

  server.registerTool(
    "drive_bulk_purge",
    {
      title: "Bulk Permanently Delete Drive Items",
      description:
        "DESTRUCTIVE. Hard-delete N TRASHED items. Items not currently in trash are silently skipped. Requires drive:*:purge scope AND TREKMAIL_ALLOW_DESTRUCTIVE=true.",
      inputSchema: {
        space: z.string(),
        file_ids: z.array(z.number().int().positive()).default([]),
        folder_ids: z.array(z.number().int().positive()).default([]),
      },
      annotations: { destructiveHint: true },
    },
    async ({ space, file_ids, folder_ids }) => {
      const blocked = requireDestructive("bulk purge");
      if (blocked) return blocked;
      return callApi(() => client.bulkDrivePurge(space, file_ids, folder_ids, randomUUID()));
    },
  );

  // ─── Share-links ──────────────────────────────────────────────────

  server.registerTool(
    "drive_share_create",
    {
      title: "Create Drive Share Link",
      description:
        "Mint a public share link for the file. Returns a raw token in the 'token' field — store it now, the API never returns it again. The 'public_url' field is the full /d/{token} URL ready to share.",
      inputSchema: {
        file_id: z.number().int().positive(),
        expires_at: z.string().optional().describe("ISO-8601 timestamp; omit for no expiry"),
        max_downloads: z.number().int().min(1).optional().describe("Cap downloads; omit for unlimited"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ file_id, expires_at, max_downloads }) => {
      const blocked = requireDestructive("share-link create");
      if (blocked) return blocked;
      return callApi(() =>
        client.createDriveShareLink(
          file_id,
          { expires_at, max_downloads },
          randomUUID(),
        ),
      );
    },
  );

  server.registerTool(
    "drive_share_list",
    {
      title: "List Drive Share Links",
      description:
        "All share-links for a file (active + revoked). Raw tokens are NEVER included — use create's response to capture them.",
      inputSchema: { file_id: z.number().int().positive() },
    },
    async ({ file_id }) => callApi(() => client.listDriveShareLinks(file_id)),
  );

  server.registerTool(
    "drive_share_revoke",
    {
      title: "Revoke Drive Share Link",
      description: "Revoke a share-link by id. Idempotent — second call no-ops.",
      inputSchema: { link_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ link_id }) => {
      const blocked = requireDestructive("share-link revoke");
      if (blocked) return blocked;
      return callApi(() => client.revokeDriveShareLink(link_id));
    },
  );

  // ─── Uploads (low-level — high-level wrapper deferred) ────────────

  server.registerTool(
    "drive_upload_initiate",
    {
      title: "Initiate Drive Upload",
      description:
        "Reserve quota and return presigned B2 PUT URLs. For files <100MB you get one URL; for larger files you get a multipart description (parts[]). The returned file row sits in pending_upload status until drive_upload_complete confirms B2 received the bytes.",
      inputSchema: {
        space: z.string(),
        name: z.string().min(1).max(255),
        size_bytes: z.number().int().nonnegative(),
        folder_id: z.number().int().positive().nullable().optional(),
        client_mime: z.string().max(255).optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ space, name, size_bytes, folder_id, client_mime }) => {
      const blocked = requireDestructive("upload initiate");
      if (blocked) return blocked;
      return callApi(() =>
        client.initiateDriveUpload(space, name, size_bytes, folder_id ?? null, client_mime, randomUUID()),
      );
    },
  );

  server.registerTool(
    "drive_upload_complete",
    {
      title: "Complete Drive Upload",
      description:
        "Finalise after the bytes are PUT to B2. Multipart calls must include parts:[{part_number,etag}] from each PUT response (etag stripped of B2's surrounding quotes). Single-PUT (small) calls send no parts.",
      inputSchema: {
        file_id: z.number().int().positive(),
        parts: z
          .array(z.object({ part_number: z.number().int().positive(), etag: z.string() }))
          .optional(),
      },
      annotations: { destructiveHint: true },
    },
    async ({ file_id, parts }) => {
      const blocked = requireDestructive("upload complete");
      if (blocked) return blocked;
      return callApi(() => client.completeDriveUpload(file_id, parts));
    },
  );

  server.registerTool(
    "drive_upload_refresh_parts",
    {
      title: "Refresh Drive Upload Parts",
      description:
        "Re-presign expired part URLs for an in-flight multipart upload. Send the PartNumbers you still need.",
      inputSchema: {
        file_id: z.number().int().positive(),
        part_numbers: z.array(z.number().int().positive()).min(1),
      },
      annotations: { destructiveHint: true },
    },
    async ({ file_id, part_numbers }) => {
      const blocked = requireDestructive("upload refresh-parts");
      if (blocked) return blocked;
      return callApi(() => client.refreshDriveUploadParts(file_id, part_numbers));
    },
  );

  server.registerTool(
    "drive_upload_abort",
    {
      title: "Abort Drive Upload",
      description: "Cancel an in-flight upload, release the reserved quota, and clean up B2 multipart state.",
      inputSchema: { file_id: z.number().int().positive() },
      annotations: { destructiveHint: true },
    },
    async ({ file_id }) => {
      const blocked = requireDestructive("upload abort");
      if (blocked) return blocked;
      return callApi(() => client.abortDriveUpload(file_id));
    },
  );

  // ─── Drive add-on ─────────────────────────────────────────────────

  server.registerTool(
    "drive_addon_get",
    {
      title: "Get Drive Add-on State",
      description:
        "Current Drive Storage Add-on state: active flag, in_grace, size_gb, period end, hard-delete date if cancelled.",
      inputSchema: {},
    },
    async () => callApi(() => client.getDriveAddon()),
  );

  server.registerTool(
    "drive_addon_pricing",
    {
      title: "Drive Add-on Pricing Ladder",
      description:
        "Pricing snap-points (250GB → 100TB) with monthly + yearly amounts in the requested currency. Default currency comes from the account's currency_preference.",
      inputSchema: {
        currency: z.string().length(3).optional().describe("ISO-4217 (USD/EUR/GBP/etc.); defaults to account preference"),
      },
    },
    async ({ currency }) => callApi(() => client.getDriveAddonPricing(currency)),
  );

  server.registerTool(
    "drive_addon_cancellation_preview",
    {
      title: "Drive Add-on Cancellation Preview",
      description:
        "What happens if the user cancels the add-on now: addon size vs plan quota, over-quota delta, sample of largest at-risk files, 7-day grace note. Read-only.",
      inputSchema: {},
    },
    async () => callApi(() => client.getDriveAddonCancellationPreview()),
  );

  // ─── High-level upload (one tool, three API calls + B2 PUT(s)) ────
  //
  // Stdio-only tool: `local_path` semantically means "a file on the
  // machine running the MCP". On the hosted HTTP MCP that machine is
  // our server — exposing the tool there lets any OAuth-connected agent
  // read `/proc/self/environ` / `.env` / SSH keys (ticket #170). Skipped
  // unconditionally when `httpTransport` is set; the scope-map regex
  // still sees the registerTool call statically so coverage stays intact.
  if (!config?.httpTransport) {
    server.registerTool(
      "drive_file_upload",
      {
        title: "Upload File to Drive (high-level)",
        description:
          "Upload a local file to Drive in one tool call. Internally chains drive_upload_initiate → direct PUT(s) to B2 → drive_upload_complete. Bytes go straight to B2 — they do NOT pass through the API server (the server is only touched at the start and end of the upload). Files >100 MB use multipart (50 MB chunks); the wrapper streams from disk so memory stays bounded regardless of file size. On any error the wrapper calls drive_upload_abort to release the reservation.",
        inputSchema: {
          space: z.string().describe("'account' | 'mailbox:N' | numeric space id"),
          local_path: z.string().describe("Absolute path to the file on the MCP host"),
          name: z.string().min(1).max(255).optional().describe("Display name in Drive (defaults to basename of local_path)"),
          folder_id: z.number().int().positive().nullable().optional(),
          client_mime: z.string().max(255).optional(),
        },
        annotations: { destructiveHint: true },
      },
      async ({ space, local_path, name, folder_id, client_mime }) => {
        const blocked = requireDestructive("file upload");
        if (blocked) return blocked;
        try {
          assertUploadPathAllowed(local_path);
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err));
        }
        try {
          const result = await uploadFileFromPath(client, {
            space,
            localPath: local_path,
            name,
            folderId: folder_id ?? null,
            clientMime: client_mime,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          return errorResult(
            `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
  }
}

/**
 * High-level upload orchestration. Pure helper — each step uses the
 * existing TrekMailClient methods (initiate/complete/refresh/abort) plus
 * one or many direct fetch() calls to the B2 presigned URLs.
 *
 * Returns the same shape as drive_upload_complete.
 */
async function uploadFileFromPath(
  client: TrekMailClient,
  params: {
    space: string;
    localPath: string;
    name?: string;
    folderId: number | null;
    clientMime?: string;
  },
): Promise<unknown> {
  const stats = statSync(params.localPath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a regular file: ${params.localPath}`);
  }
  const sizeBytes = stats.size;
  const displayName = params.name ?? params.localPath.split("/").pop() ?? "upload";

  const initiateRaw = (await client.initiateDriveUpload(
    params.space,
    displayName,
    sizeBytes,
    params.folderId,
    params.clientMime,
    randomUUID(),
  )) as InitiateResponse;

  const fileId = initiateRaw.file_id;

  if (!initiateRaw.multipart) {
    // Small upload: single PUT.
    if (!initiateRaw.upload_url) {
      throw new Error("initiate response missing upload_url for small upload");
    }
    await singlePut(initiateRaw.upload_url, initiateRaw.headers ?? {}, params.localPath, sizeBytes, async () => {
      await safeAbort(client, fileId);
    });
    return client.completeDriveUpload(fileId);
  }

  // Multipart: stream chunks per part.
  const partSize = initiateRaw.part_size_bytes;
  // Field shape MUST match what /uploads/{file}:complete validates and
  // what DriveUploadService::completeMultipart consumes ($p['part_number']
  // + $p['etag']). Audit finding #2 — earlier PascalCase shape was
  // silently coerced to null on the server side.
  const etags: Array<{ part_number: number; etag: string }> = [];

  try {
    for (const part of initiateRaw.parts) {
      const startByte = (part.part_number - 1) * partSize;
      // end is INCLUSIVE for fs.createReadStream.
      const endByte = Math.min(startByte + partSize - 1, sizeBytes - 1);
      let url = part.upload_url;
      let etag = await putPart(url, params.localPath, startByte, endByte);
      // 403 is B2's "URL expired" — refresh and retry once.
      if (etag === null) {
        const refreshed = (await client.refreshDriveUploadParts(fileId, [part.part_number])) as RefreshResponse;
        const fresh = refreshed.parts?.find((p) => p.part_number === part.part_number);
        if (!fresh) {
          throw new Error(`Failed to refresh part ${part.part_number} URL`);
        }
        url = fresh.upload_url;
        etag = await putPart(url, params.localPath, startByte, endByte);
        if (etag === null) {
          throw new Error(`B2 PUT for part ${part.part_number} still failed after refresh`);
        }
      }
      etags.push({ part_number: part.part_number, etag });
    }
  } catch (err) {
    await safeAbort(client, fileId);
    throw err;
  }

  return client.completeDriveUpload(fileId, etags);
}

interface InitiateResponse {
  file_id: number;
  multipart: boolean;
  upload_url?: string;
  headers?: Record<string, string>;
  upload_id?: string;
  part_size_bytes: number;
  parts: Array<{ part_number: number; upload_url: string }>;
  expires_at: string;
}

interface RefreshResponse {
  parts: Array<{ part_number: number; upload_url: string }>;
}

async function singlePut(
  url: string,
  headers: Record<string, string>,
  localPath: string,
  sizeBytes: number,
  onError: () => Promise<void>,
): Promise<void> {
  const stream = createReadStream(localPath);
  // Cast Node Readable → Web ReadableStream for the global fetch.
  // Node 18+ supports this via Readable.toWeb(); fall back to the raw
  // stream in older runtimes (the API server requires Node 22 anyway).
  const body = "toWeb" in Readable
    ? (Readable as unknown as { toWeb: (s: NodeJS.ReadableStream) => ReadableStream }).toWeb(stream)
    : (stream as unknown as ReadableStream);

  const resp = await fetch(url, {
    method: "PUT",
    body,
    headers: {
      ...headers,
      "Content-Length": String(sizeBytes),
    },
    // @ts-ignore — undici-specific: required when streaming a Node ReadStream as
    // fetch body. NOT @ts-expect-error because newer @types/node (used by the
    // mcp-http build) added `duplex` to RequestInit while the standalone
    // mcp/trekmail-mcp build still needs the suppression — @ts-ignore is the
    // only form that satisfies BOTH tsconfigs (acc #495 deploy 2026-05-23).
    duplex: "half",
  });

  if (!resp.ok) {
    await onError();
    throw new Error(`B2 PUT failed: ${resp.status} ${resp.statusText}`);
  }
}

/**
 * Returns the ETag string (without surrounding quotes), or null if the
 * PUT failed with a 403 (signed URL expired) so the caller can retry
 * after refresh-parts. Other failures throw.
 */
async function putPart(
  url: string,
  localPath: string,
  startByte: number,
  endByte: number,
): Promise<string | null> {
  const stream = createReadStream(localPath, { start: startByte, end: endByte });
  const body = "toWeb" in Readable
    ? (Readable as unknown as { toWeb: (s: NodeJS.ReadableStream) => ReadableStream }).toWeb(stream)
    : (stream as unknown as ReadableStream);

  const sizeBytes = endByte - startByte + 1;
  const resp = await fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Length": String(sizeBytes) },
    // @ts-ignore — undici duplex required for streaming bodies. See B2_PUT
    // putBytes() above for the rationale on @ts-ignore vs @ts-expect-error.
    duplex: "half",
  });

  if (resp.status === 403) {
    return null;
  }
  if (!resp.ok) {
    throw new Error(`B2 PUT part failed: ${resp.status} ${resp.statusText}`);
  }
  const etag = resp.headers.get("etag");
  if (!etag) {
    throw new Error("B2 PUT response missing ETag header");
  }
  // B2 returns ETag wrapped in double quotes; strip them — completeMultipart
  // expects the bare hex.
  return etag.replace(/^"|"$/g, "");
}

async function safeAbort(client: TrekMailClient, fileId: number): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.abortDriveUpload(fileId);
      return;
    } catch {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
  }
  // Best effort — quota will be reclaimed by the GC job within an hour
  // even if abort fails. Don't mask the original upload error with an
  // abort error.
}
