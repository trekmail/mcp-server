import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { idempotencyKey, operationIdempotencyKey } from "../idempotency.js";
import { callApi, errorResult } from "./util.js";

/**
 * Mailbox app passwords (REST `/api/v1/mailboxes/{id}/app-passwords` and
 * `POST /api/v1/mailboxes/{id}:client-auth-mode`).
 *
 * An app password is a separate password a mail app (IMAP, SMTP, ManageSieve,
 * CalDAV/CardDAV) signs in with; it never opens TrekMail webmail (classic
 * webmail, /webmail-old/, is an ordinary IMAP client and does take it). The secret is
 * returned exactly once, under data.password, by create and rotate. The API's
 * idempotency layer strips it from what it stores, so a replayed call comes
 * back without it (and with `_idempotency_replay_warning`): the way to get a
 * usable secret again is to rotate, never to ask the API twice. That is why
 * create takes a fresh key per call (transport retries inside one call still
 * share it) rather than one derived from its arguments: a second, deliberate
 * "create 'iPhone'" must mint a password, not replay one that carries none.
 *
 * Every write needs TREKMAIL_ALLOW_DESTRUCTIVE=true. Creating one is
 * credential issuance (the same gate as drive_device_create); rotating and
 * revoking cut off a running mail app; tightening the mode signs out every
 * mail app still using the mailbox password.
 */
const CLIENT_AUTH_MODES = ["app_password_only", "password_or_app_password"] as const;

const ONE_TIME_SECRET_HANDLING =
  "Give data.password to the user once, in this reply, and tell them to paste it into the mail app now: it cannot be shown again. Do not store it, write it to a file or memory, or repeat it in later messages or tool calls. Spaces and capital letters in it do not matter.";

export function registerMailboxAppPasswordTools(
  server: McpServer,
  client: TrekMailClient,
  config?: { allowDestructive?: boolean },
): void {
  const requireDestructive = (action: string) => {
    if (!config?.allowDestructive) {
      return errorResult(
        `Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to ${action}.`,
      );
    }
    return null;
  };

  server.registerTool(
    "list_mailbox_app_passwords",
    {
      title: "List Mailbox App Passwords",
      description:
        "List a mailbox's app passwords: the separate passwords mail apps (IMAP, SMTP, ManageSieve, CalDAV/CardDAV) sign in with. Returns client_auth_mode, the per-mailbox limit, active_count, and per row id, name, created_at, created_via, last_used_at, last_used_ip, last_used_protocol, revoked_at, revoked_reason and active. Secrets are never returned. client_auth_mode 'app_password_only' means mail apps must use an app password; 'password_or_app_password' means the mailbox password works in them too. TrekMail webmail always takes the mailbox password; classic webmail (/webmail-old/) is a mail app here, so on an app_password_only mailbox it takes an app password. A not_found error for a mailbox that exists means app passwords are not available on this platform yet.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The regular mailbox ID (shared mailboxes have no app passwords)"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ mailbox_id }) => callApi(() => client.listMailboxAppPasswords(mailbox_id)),
  );

  server.registerTool(
    "create_mailbox_app_password",
    {
      title: "Create Mailbox App Password",
      description:
        `Create an app password for one mail app or device on a mailbox: 16 lowercase letters, returned once under data.password (show it to the user in four groups of four, e.g. 'abcd efgh ijkl mnop'). It works for IMAP, SMTP (ports 465 and 587), ManageSieve and CalDAV/CardDAV, with the mailbox address as the username. It never opens TrekMail webmail, which takes the mailbox password; classic webmail (/webmail-old/) is a mail app here and accepts it. ${ONE_TIME_SECRET_HANDLING} Up to 25 active per mailbox (error app_password_limit_reached: revoke an unused one first). Refused for shared mailboxes and for mailboxes that are paused or whose sign-in is suspended (mailbox_not_eligible). If a reused idempotency_key brings back a response without the password (_idempotency_replay_warning), use rotate_mailbox_app_password on data.id to get a usable secret. Call get_mail_client_setup for the server settings to give with it.`,
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The regular mailbox ID"),
        name: z
          .string()
          .min(1)
          .max(64)
          .describe("What the password is for, so the user can tell it apart later, e.g. 'Outlook on work laptop' or 'iPhone'"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key. Omit it: every call then creates a new app password, and retries inside the call are still deduplicated."),
      },
      // Minting a credential: confirm first, like drive_device_create.
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, name, idempotency_key }) => {
      const gated = requireDestructive("create app passwords (each one is a new credential)");
      if (gated !== null) return gated;
      const idemKey = operationIdempotencyKey("create_mailbox_app_password", idempotency_key);
      return callApi(() => client.createMailboxAppPassword(mailbox_id, name, idemKey));
    },
  );

  server.registerTool(
    "rotate_mailbox_app_password",
    {
      title: "Replace Mailbox App Password",
      description:
        `Replace an app password with a new secret under the same name. The old secret stops working at once and the mail apps using it are signed out until the user enters the new one. Returns the new row (new data.id) with data.password once, plus replaced_id. ${ONE_TIME_SECRET_HANDLING} Use this when the user lost the password or wants a fresh one; to stop a device for good, use revoke_mailbox_app_password. Fails with conflict if the app password was already revoked.`,
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID the app password belongs to"),
        app_password_id: z
          .number()
          .int()
          .positive()
          .describe("The app password row ID from list_mailbox_app_passwords"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, app_password_id, idempotency_key }) => {
      const gated = requireDestructive("replace app passwords (the old one stops working at once)");
      if (gated !== null) return gated;
      const idemKey = idempotencyKey(
        "rotate_mailbox_app_password",
        { mailbox_id, app_password_id },
        idempotency_key,
      );
      return callApi(() =>
        client.rotateMailboxAppPassword(mailbox_id, app_password_id, idemKey),
      );
    },
  );

  server.registerTool(
    "revoke_mailbox_app_password",
    {
      title: "Revoke Mailbox App Password",
      description:
        "Revoke an app password for good. The mail app using it is signed out and cannot sign in again with it; the row stays in the list as revoked. Cannot be undone: to let the same app back in, create a new app password. Fails with conflict if it was already revoked.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The mailbox ID the app password belongs to"),
        app_password_id: z
          .number()
          .int()
          .positive()
          .describe("The app password row ID from list_mailbox_app_passwords"),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, app_password_id, idempotency_key }) => {
      const gated = requireDestructive("revoke app passwords");
      if (gated !== null) return gated;
      const idemKey = idempotencyKey(
        "revoke_mailbox_app_password",
        { mailbox_id, app_password_id },
        idempotency_key,
      );
      return callApi(() =>
        client.revokeMailboxAppPassword(mailbox_id, app_password_id, idemKey),
      );
    },
  );

  // One mailbox per call today. The bulk endpoint (POST
  // /mailboxes:client-auth-mode with mailbox_ids | domain_id | all) is not in
  // the API yet. When it lands, make mailbox_id optional, add those
  // three selectors with the "exactly one" check set_mailboxes_login_access
  // uses, and send mailbox_id to the per-mailbox route as now: the name and
  // the client_auth_mode field stay, so existing callers keep working.
  server.registerTool(
    "set_mailbox_client_auth_mode",
    {
      title: "Set Mailbox Mail-App Sign-In Mode",
      description:
        "Choose what mail apps (IMAP, SMTP, ManageSieve, CalDAV/CardDAV) may sign in to a mailbox with. 'app_password_only': only app passwords work in mail apps; open mail-app sessions are signed out (apps using an app password reconnect on their own) and an app that tries the mailbox password gets 'Sign-in failed. This mailbox accepts app passwords only'. 'password_or_app_password': the mailbox password works in mail apps again, next to app passwords. TrekMail webmail always signs in with the mailbox password (plus two-factor when it is on) in both modes; classic webmail (/webmail-old/) is a mail app here, so on an app_password_only mailbox it needs an app password too. Before tightening, create an app password for each device the user still syncs (create_mailbox_app_password), or those devices stop. Refused for shared mailboxes, and platform system mailboxes cannot be made app_password_only. Setting the current mode again changes nothing. Works on one mailbox per call.",
      inputSchema: {
        mailbox_id: z
          .number()
          .int()
          .positive()
          .describe("The regular mailbox ID"),
        client_auth_mode: z
          .enum(CLIENT_AUTH_MODES)
          .describe(
            "'app_password_only' requires app passwords in mail apps; 'password_or_app_password' also accepts the mailbox password.",
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, client_auth_mode, idempotency_key }) => {
      const gated = requireDestructive("change how mail apps sign in");
      if (gated !== null) return gated;
      // A key derived from the arguments would make "tighten, loosen,
      // tighten" inside the API's 24-hour idempotency window replay the first
      // answer and leave the mailbox loose. Repeating a mode is already a
      // no-op on the server, so one key per call loses nothing.
      const idemKey = operationIdempotencyKey("set_mailbox_client_auth_mode", idempotency_key);
      return callApi(() =>
        client.setMailboxClientAuthMode(mailbox_id, client_auth_mode, idemKey),
      );
    },
  );
}
