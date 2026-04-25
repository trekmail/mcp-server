import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { registerAccountTools } from "./account.js";
import { registerDomainTools } from "./domains.js";
import { registerDnsTools } from "./dns.js";
import { registerMailboxTools } from "./mailboxes.js";
import { registerInviteTools } from "./invites.js";
import { registerAliasTools } from "./aliases.js";
import { registerForwardingTools } from "./forwarding.js";
import { registerRulesTools } from "./rules.js";
import { registerAutoReplyTools } from "./auto-reply.js";
import { registerSieveTools } from "./sieve.js";
import { registerDeleteIntentTools } from "./delete-intents.js";
import { registerMigrationTools } from "./migrations.js";
import { registerTicketTools } from "./tickets.js";
import { registerSmtpTools } from "./smtp.js";
import { registerMessageToolHandlers } from "./messages.js";
import { registerMessageFolderTools } from "./message-folders.js";
import { registerMessageScheduledTools } from "./message-scheduled.js";
import { registerMessageContactTools } from "./message-contacts.js";
import { registerMessageContactGroupTools } from "./message-contact-groups.js";
import { registerMessageCalendarTools } from "./message-calendar.js";
import { registerMessageComposeTools } from "./message-compose.js";
import { registerMessageIdentityTools } from "./message-identities.js";
import { registerMessageTemplateTools } from "./message-templates.js";
import { registerMessageBlockedTools } from "./message-blocked.js";
import { registerMessageTokenTools } from "./message-tokens.js";
import { registerSpamStatsTools } from "./spam-stats.js";
import { registerVerifierTools } from "./verifier.js";
import { registerCloudflareTools } from "./cloudflare.js";

/**
 * Register infrastructure tools (domains, DNS, mailboxes, invites, forwarding, delete).
 * Requires an ops API token (tm_live_).
 */
export function registerInfraTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  registerAccountTools(server, client);
  registerDomainTools(server, client, config);
  registerDnsTools(server, client);
  registerMailboxTools(server, client, { allowDestructive: config.allowDestructive });
  registerInviteTools(server, client);
  registerAliasTools(server, client, config);
  registerForwardingTools(server, client);
  registerRulesTools(server, client, config);
  registerAutoReplyTools(server, client);
  registerSieveTools(server, client);
  registerDeleteIntentTools(server, client, config);
  registerMigrationTools(server, client, config);
  registerTicketTools(server, client);
  registerSmtpTools(server, client, config);
  registerMessageTokenTools(server, client, config);
  registerSpamStatsTools(server, client);
  registerVerifierTools(server, client);
  registerCloudflareTools(server, client, config);
}

/**
 * Register message tools (list, read, send).
 * Requires a message token (tm_msg_).
 */
export function registerMessageTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  registerMessageToolHandlers(server, client, config);
  registerMessageFolderTools(server, client, config);
  registerMessageScheduledTools(server, client, config);
  registerMessageContactTools(server, client, config);
  registerMessageContactGroupTools(server, client, config);
  registerMessageCalendarTools(server, client, config);
  registerMessageComposeTools(server, client);
  registerMessageIdentityTools(server, client, config);
  registerMessageTemplateTools(server, client, config);
  registerMessageBlockedTools(server, client, config);
}
