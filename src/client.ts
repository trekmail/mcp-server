import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { TrekMailApiError, TrekMailClientError } from "./errors.js";
import { withRetry } from "./retry.js";

export interface ClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  userAgent: string;
}

export interface ListParams {
  page?: number;
  per_page?: number;
  search?: string;
}

export interface ListDomainsParams extends ListParams {
  status?: string;
}

export interface ListMailboxesParams extends ListParams {
  domain_id?: number;
}

export interface CreateMailboxParams {
  domain_id: number;
  local_part: string;
  display_name?: string;
}

export interface CreateInviteParams {
  domain_id: number;
  local_part: string;
  recipient_email: string;
  expires_in_hours?: number;
}

export interface CreateInvitesBulkParams {
  domain_id: number;
  items: Array<{
    local_part: string;
    recipient_email: string;
  }>;
  expires_in_hours?: number;
}

export interface SetForwardingParams {
  enabled: boolean;
  targets?: string[];
  keep_copy?: boolean;
}

export interface ListMessagesParams {
  folder?: string;
  limit?: number;
  before_uid?: number;
  since?: string;
  unread_only?: boolean;
  search?: string;
}

export interface StartMigrationParams {
  mailbox_id: number;
  provider: string;
  source_host: string;
  source_port: number;
  source_security: string;
  source_email: string;
  source_username?: string;
  source_password: string;
  target_password: string;
  selected_folders?: string[];
  import_since?: string;
  skip_duplicates?: boolean;
}

export interface TestMigrationConnectionParams {
  source_host: string;
  source_port: number;
  source_security: string;
  source_email: string;
  source_username?: string;
  source_password: string;
}

export interface ListMigrationsParams extends ListParams {
  status?: string;
  mailbox_id?: number;
}

export interface BulkMigrationPreviewParams {
  data: string;
  provider?: string;
  source_host?: string;
  source_port?: number;
  source_security?: string;
  per_row_server?: boolean;
  folder_strategy?: string;
  import_since?: string;
  skip_duplicates?: boolean;
}

export interface StartBulkMigrationParams {
  data: string;
  provider?: string;
  source_host?: string;
  source_port?: number;
  source_security?: string;
  per_row_server?: boolean;
  folder_strategy?: string;
  import_since?: string;
  skip_duplicates?: boolean;
  name?: string;
}

export interface ListBulkMigrationsParams extends ListParams {
  status?: string;
}

export interface GetMessageParams {
  folder?: string;
}

export interface ListTicketsParams extends ListParams {
  status?: string;
  category?: string;
}

export interface CreateTicketParams {
  subject: string;
  category: string;
  message: string;
  priority?: string;
}

/**
 * Create a ClientConfig from the shared Config + a specific token.
 */
export function makeClientConfig(config: Config, token: string): ClientConfig {
  return {
    baseUrl: config.baseUrl,
    token,
    timeoutMs: config.timeoutMs,
    userAgent: config.userAgent,
  };
}

export class TrekMailClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(config: ClientConfig) {
    this.baseUrl = config.baseUrl;
    this.token = config.token;
    this.timeoutMs = config.timeoutMs;
    this.userAgent = config.userAgent;
  }

  // --- Account ---

  async getMe(): Promise<unknown> {
    return this.request("GET", "me");
  }

  async getAccount(): Promise<unknown> {
    return this.request("GET", "account");
  }

  async getBillingStatus(): Promise<unknown> {
    return this.request("GET", "billing/status");
  }

  async listInvoices(): Promise<unknown> {
    return this.request("GET", "billing/invoices");
  }

  // --- Domains ---

  async listDomains(params?: ListDomainsParams): Promise<unknown> {
    return this.request("GET", "domains", { query: params ? { ...params } : undefined });
  }

  async getDomain(id: number): Promise<unknown> {
    return this.request("GET", `domains/${id}`);
  }

  async createDomain(
    name: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "domains", {
      body: { name },
      idempotencyKey,
    });
  }

  async deleteDomain(
    id: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("DELETE", `domains/${id}`, { idempotencyKey });
  }

  async updateDomainCatchAll(
    domainId: number,
    enabled: boolean,
    destination?: string | null,
  ): Promise<unknown> {
    return this.request("PATCH", `domains/${domainId}/catch-all`, {
      body: { enabled, destination },
    });
  }

  async retryDomainDkim(
    domainId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `domains/${domainId}/dkim:retry`, {
      idempotencyKey,
    });
  }

  async updateDomainNote(
    domainId: number,
    note: string | null,
  ): Promise<unknown> {
    return this.request("PATCH", `domains/${domainId}/note`, {
      body: { note },
    });
  }

  async bulkAddDomains(
    domains: string[],
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "domains:bulk-add", {
      body: { domains },
      idempotencyKey,
    });
  }

  // --- DNS ---

  async getDnsRequirements(domainId: number): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/dns-requirements`);
  }

  async dnsRecheck(
    domainId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `domains/${domainId}/dns-recheck`, {
      idempotencyKey,
    });
  }

  async getDnsCheck(checkId: number): Promise<unknown> {
    return this.request("GET", `dns-checks/${checkId}`);
  }

  // --- Mailboxes ---

  async listMailboxes(params?: ListMailboxesParams): Promise<unknown> {
    return this.request("GET", "mailboxes", { query: params ? { ...params } : undefined });
  }

  async getMailbox(id: number): Promise<unknown> {
    return this.request("GET", `mailboxes/${id}`);
  }

  async changeMailboxPassword(
    mailboxId: number,
    password: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}/password`, {
      body: { password },
      idempotencyKey,
    });
  }

  async updateMailboxNote(
    mailboxId: number,
    note: string | null,
  ): Promise<unknown> {
    return this.request("PATCH", `mailboxes/${mailboxId}/note`, {
      body: { note },
    });
  }

  async pauseMailbox(
    mailboxId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}:pause`, {
      idempotencyKey,
    });
  }

  async resumeMailbox(
    mailboxId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}:resume`, {
      idempotencyKey,
    });
  }

  async enableImap(
    mailboxId: number,
    password: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}/enable-imap`, {
      body: { password },
      idempotencyKey,
    });
  }

  async bulkCreateMailboxes(
    items: Array<{ domain_id: number; local_part: string; password?: string }>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "mailboxes:bulk", {
      body: { items },
      idempotencyKey,
    });
  }

  async createMailboxGeneratedPassword(
    params: CreateMailboxParams,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "mailboxes", {
      body: { ...params, password_mode: "generated_one_time" },
      idempotencyKey,
    });
  }

  // --- Invites ---

  async createInvite(
    params: CreateInviteParams,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "mailboxes/invites", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async createInvitesBulk(
    params: CreateInvitesBulkParams,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "mailboxes/invites:bulk", {
      body: { ...params },
      idempotencyKey,
    });
  }

  // --- Forwarding ---

  async getForwarding(mailboxId: number): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/forwarding`);
  }

  async setForwarding(
    mailboxId: number,
    params: SetForwardingParams,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PUT", `mailboxes/${mailboxId}/forwarding`, {
      body: { ...params },
      idempotencyKey,
    });
  }

  // --- Mail Rules (Filters) ---

  async listMailRules(mailboxId: number): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/rules`);
  }

  async getMailRule(mailboxId: number, ruleId: number): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/rules/${ruleId}`);
  }

  async createMailRule(
    mailboxId: number,
    params: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}/rules`, {
      body: params,
      idempotencyKey,
    });
  }

  async updateMailRule(
    mailboxId: number,
    ruleId: number,
    params: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PUT", `mailboxes/${mailboxId}/rules/${ruleId}`, {
      body: params,
      idempotencyKey,
    });
  }

  async deleteMailRule(mailboxId: number, ruleId: number): Promise<unknown> {
    return this.request("DELETE", `mailboxes/${mailboxId}/rules/${ruleId}`);
  }

  async reorderMailRules(
    mailboxId: number,
    order: number[],
  ): Promise<unknown> {
    return this.request("PATCH", `mailboxes/${mailboxId}/rules/reorder`, {
      body: { order },
    });
  }

  // --- Auto-Reply ---

  async getAutoReply(mailboxId: number): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/auto-reply`);
  }

  async setAutoReply(
    mailboxId: number,
    params: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PUT", `mailboxes/${mailboxId}/auto-reply`, {
      body: params,
      idempotencyKey,
    });
  }

  // --- Aliases ---

  async listAliases(mailboxId: number): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/aliases`);
  }

  async createAlias(
    mailboxId: number,
    params: { local_part: string; domain_id: number; can_receive?: boolean; can_send?: boolean },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}/aliases`, {
      body: { ...params },
      idempotencyKey,
    });
  }

  async updateAlias(
    mailboxId: number,
    aliasId: number,
    params: { can_receive?: boolean; can_send?: boolean; is_active?: boolean },
  ): Promise<unknown> {
    return this.request("PATCH", `mailboxes/${mailboxId}/aliases/${aliasId}`, {
      body: { ...params },
    });
  }

  async deleteAlias(
    mailboxId: number,
    aliasId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("DELETE", `mailboxes/${mailboxId}/aliases/${aliasId}`, {
      idempotencyKey,
    });
  }

  // --- Raw Sieve ---

  async getSieveScript(mailboxId: number): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/sieve`);
  }

  async uploadSieveScript(
    mailboxId: number,
    script: string,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PUT", `mailboxes/${mailboxId}/sieve`, {
      body: { script },
      idempotencyKey,
    });
  }

  // --- Delete Intents ---

  async createDeleteIntent(
    mailboxId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}:delete-intent`, {
      idempotencyKey,
    });
  }

  async confirmDeleteIntent(
    intentId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `delete-intents/${intentId}:confirm`, {
      idempotencyKey,
      headers: { "X-Confirm-Delete": "true" },
    });
  }

  // --- Migrations ---

  async testMigrationConnection(params: TestMigrationConnectionParams, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", "migrations/test-connection", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async listMigrations(params?: ListMigrationsParams): Promise<unknown> {
    return this.request("GET", "migrations", { query: params ? { ...params } : undefined });
  }

  async getMigration(id: number): Promise<unknown> {
    return this.request("GET", `migrations/${id}`);
  }

  async startMigration(params: StartMigrationParams, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", "migrations", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async cancelMigration(id: number, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", `migrations/${id}:cancel`, { idempotencyKey });
  }

  async retryMigration(id: number, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", `migrations/${id}:retry`, { idempotencyKey });
  }

  async deleteMigration(id: number, idempotencyKey: string): Promise<unknown> {
    return this.request("DELETE", `migrations/${id}`, { idempotencyKey });
  }

  // --- Bulk Migrations ---

  async previewBulkMigration(params: BulkMigrationPreviewParams, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", "migrations/bulk/preview", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async startBulkMigration(params: StartBulkMigrationParams, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", "migrations/bulk", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async listBulkMigrations(params?: ListBulkMigrationsParams): Promise<unknown> {
    return this.request("GET", "migrations/bulk", { query: params ? { ...params } : undefined });
  }

  async getBulkMigration(id: number): Promise<unknown> {
    return this.request("GET", `migrations/bulk/${id}`);
  }

  async cancelBulkMigration(id: number, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", `migrations/bulk/${id}:cancel`, { idempotencyKey });
  }

  async retryBulkMigration(id: number, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", `migrations/bulk/${id}:retry`, { idempotencyKey });
  }

  async resumeBulkMigration(id: number, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", `migrations/bulk/${id}:resume`, { idempotencyKey });
  }

  async deleteBulkMigration(id: number, idempotencyKey: string): Promise<unknown> {
    return this.request("DELETE", `migrations/bulk/${id}`, { idempotencyKey });
  }

  async updateBulkMigrationJobPassword(
    batchId: number,
    jobId: number,
    sourcePassword: string,
  ): Promise<unknown> {
    return this.request("PATCH", `migrations/bulk/${batchId}/jobs/${jobId}/password`, {
      body: { source_password: sourcePassword },
    });
  }

  // --- Tickets ---

  async listTickets(params?: ListTicketsParams): Promise<unknown> {
    return this.request("GET", "tickets", { query: params ? { ...params } : undefined });
  }

  async getTicket(id: number): Promise<unknown> {
    return this.request("GET", `tickets/${id}`);
  }

  async getTicketMessages(ticketId: number): Promise<unknown> {
    return this.request("GET", `tickets/${ticketId}/messages`);
  }

  async createTicket(params: CreateTicketParams, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", "tickets", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async replyToTicket(ticketId: number, message: string, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", `tickets/${ticketId}/reply`, {
      body: { message },
      idempotencyKey,
    });
  }

  async closeTicket(ticketId: number, idempotencyKey: string): Promise<unknown> {
    return this.request("POST", `tickets/${ticketId}:close`, { idempotencyKey });
  }

  // --- SMTP ---

  async getSmtpConfig(): Promise<unknown> {
    return this.request("GET", "smtp");
  }

  async updateSmtpConfig(
    params: {
      mode: string;
      host?: string;
      port?: number;
      encryption?: string;
      username?: string;
      password?: string;
    },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PUT", "smtp", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async deleteSmtpConnection(id: number, idempotencyKey?: string): Promise<unknown> {
    return this.request("DELETE", `smtp/${id}`, { idempotencyKey });
  }

  async testSmtp(
    params: {
      host: string;
      port: number;
      encryption: string;
      username: string;
      password: string;
    },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "smtp:test", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async getSmtpTestStatus(jobId: string): Promise<unknown> {
    return this.request("GET", `smtp:test-status/${jobId}`);
  }

  // --- Messages ---

  async listMessages(params?: ListMessagesParams): Promise<unknown> {
    return this.request("GET", "messages", {
      query: params ? { ...params } : undefined,
    });
  }

  async getMessage(uid: number, params?: GetMessageParams): Promise<unknown> {
    return this.request("GET", `messages/${uid}`, {
      query: params ? { ...params } : undefined,
    });
  }

  async sendMessage(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "messages/send", {
      body,
      idempotencyKey,
    });
  }

  async updateMessageFlags(
    uid: number,
    flags: { seen?: boolean; flagged?: boolean },
    params?: { folder?: string },
  ): Promise<unknown> {
    return this.request("PATCH", `messages/${uid}`, {
      body: { flags, folder: params?.folder },
    });
  }

  async deleteMessage(uid: number, params?: { folder?: string }): Promise<unknown> {
    return this.request("DELETE", `messages/${uid}`, {
      query: params ? { ...params } : undefined,
    });
  }

  async moveMessage(
    uid: number,
    params: { folder?: string; destination: string },
  ): Promise<unknown> {
    return this.request("POST", `messages/${uid}:move`, {
      body: { folder: params.folder, destination: params.destination },
    });
  }

  async listFolders(): Promise<unknown> {
    return this.request("GET", "messages/folders");
  }

  async downloadAttachment(
    uid: number,
    index: number,
    params?: { folder?: string },
  ): Promise<unknown> {
    return this.request("GET", `messages/${uid}/attachments/${index}`, {
      query: params ? { ...params } : undefined,
    });
  }

  async downloadAllAttachments(
    uid: number,
    params?: { folder?: string },
  ): Promise<unknown> {
    return this.request("GET", `messages/${uid}/attachments`, {
      query: params ? { ...params } : undefined,
    });
  }

  async getRawMessage(
    uid: number,
    params?: { folder?: string },
  ): Promise<unknown> {
    return this.request("GET", `messages/${uid}/raw`, {
      query: params ? { ...params } : undefined,
    });
  }

  async createFolder(name: string): Promise<unknown> {
    return this.request("POST", "messages/folders", {
      body: { name },
    });
  }

  async renameFolder(path: string, name: string): Promise<unknown> {
    return this.request("PATCH", `messages/folders/${encodeURIComponent(path)}`, {
      body: { name },
    });
  }

  async deleteFolder(path: string): Promise<unknown> {
    return this.request("DELETE", `messages/folders/${encodeURIComponent(path)}`);
  }

  async saveDraft(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/drafts", { body });
  }

  async updateDraft(
    uid: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("PUT", `messages/drafts/${uid}`, { body });
  }

  async reportSpam(
    uid: number,
    params?: { folder?: string },
  ): Promise<unknown> {
    return this.request("POST", `messages/${uid}:spam`, {
      body: { folder: params?.folder },
    });
  }

  async reportHam(
    uid: number,
    params?: { folder?: string },
  ): Promise<unknown> {
    return this.request("POST", `messages/${uid}:ham`, {
      body: { folder: params?.folder },
    });
  }

  async bulkAction(params: {
    folder: string;
    uids: number[];
    action: string;
    destination?: string;
  }): Promise<unknown> {
    return this.request("POST", "messages/bulk", { body: params });
  }

  async emptyFolder(folder: string): Promise<unknown> {
    return this.request("POST", "messages/folders:empty", {
      body: { folder },
    });
  }

  // --- Reply / Forward ---

  async getReply(uid: number, params?: { folder?: string }): Promise<unknown> {
    return this.request("GET", `messages/${uid}/reply`, {
      query: params ? { ...params } : undefined,
    });
  }

  async getReplyAll(uid: number, params?: { folder?: string }): Promise<unknown> {
    return this.request("GET", `messages/${uid}/reply-all`, {
      query: params ? { ...params } : undefined,
    });
  }

  async getForward(uid: number, params?: { folder?: string }): Promise<unknown> {
    return this.request("GET", `messages/${uid}/forward`, {
      query: params ? { ...params } : undefined,
    });
  }

  // --- Contact Groups ---

  async listContactGroups(): Promise<unknown> {
    return this.request("GET", "messages/contact-groups");
  }

  async createContactGroup(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/contact-groups", { body });
  }

  async updateContactGroup(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `messages/contact-groups/${id}`, { body });
  }

  async deleteContactGroup(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/contact-groups/${id}`);
  }

  async addContactGroupMembers(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", `messages/contact-groups/${id}/members`, { body });
  }

  async removeContactGroupMembers(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("DELETE", `messages/contact-groups/${id}/members`, { body });
  }

  // --- Identities ---

  async listIdentities(): Promise<unknown> {
    return this.request("GET", "messages/identities");
  }

  async createIdentity(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/identities", { body });
  }

  async updateIdentity(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `messages/identities/${id}`, { body });
  }

  async deleteIdentity(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/identities/${id}`);
  }

  // --- Templates ---

  async listTemplates(): Promise<unknown> {
    return this.request("GET", "messages/templates");
  }

  async createTemplate(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/templates", { body });
  }

  async updateTemplate(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `messages/templates/${id}`, { body });
  }

  async deleteTemplate(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/templates/${id}`);
  }

  // --- Blocked Senders ---

  async listBlockedSenders(): Promise<unknown> {
    return this.request("GET", "messages/blocked-senders");
  }

  async blockSender(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/blocked-senders", { body });
  }

  async unblockSender(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/blocked-senders/${id}`);
  }

  // --- Scheduled Send ---

  async scheduleMessage(
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "messages/scheduled", {
      body,
      idempotencyKey,
    });
  }

  async listScheduled(): Promise<unknown> {
    return this.request("GET", "messages/scheduled");
  }

  async cancelScheduled(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/scheduled/${id}`);
  }

  // --- Contacts ---

  async listContacts(params?: { q?: string; per_page?: number; page?: number }): Promise<unknown> {
    return this.request("GET", "messages/contacts", {
      query: params ? { ...params } : undefined,
    });
  }

  async createContact(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/contacts", { body });
  }

  async updateContact(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `messages/contacts/${id}`, { body });
  }

  async deleteContact(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/contacts/${id}`);
  }

  async importContacts(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/contacts/import", { body });
  }

  async exportContacts(params?: { format?: string }): Promise<unknown> {
    return this.request("GET", "messages/contacts/export", {
      query: params ? { ...params } : undefined,
    });
  }

  // --- Calendar ---

  async listCalendarEvents(params: { start: string; end: string }): Promise<unknown> {
    return this.request("GET", "messages/calendar/events", {
      query: { ...params },
    });
  }

  async createCalendarEvent(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/calendar/events", { body });
  }

  async updateCalendarEvent(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `messages/calendar/events/${id}`, { body });
  }

  async deleteCalendarEvent(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/calendar/events/${id}`);
  }

  // --- Message Tokens ---

  async createMessageToken(
    mailboxId: number,
    params: { name: string; scopes: string[]; expires_in?: string },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}/message-tokens`, {
      body: params,
      idempotencyKey,
    });
  }

  async listMessageTokens(
    mailboxId: number,
    params?: { page?: number; per_page?: number },
  ): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/message-tokens`, {
      query: params ? { ...params } : undefined,
    });
  }

  async revokeMessageToken(tokenId: number): Promise<unknown> {
    return this.request("DELETE", `message-tokens/${tokenId}`);
  }

  // --- Spam Metrics ---

  async getSpamMetrics(
    domainId: number,
    days?: number,
  ): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/spam-metrics`, {
      query: { days: days ?? 30 },
    });
  }

  async getSpamSummary(
    domainId: number,
    days?: number,
  ): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/spam-metrics/summary`, {
      query: { days: days ?? 30 },
    });
  }

  // --- Email Verifier ---

  async verifySingleEmail(email: string, mode?: string): Promise<unknown> {
    return this.request("POST", "verify", {
      body: { email, ...(mode && { mode }) },
    });
  }

  async verifyBulkEmails(
    emails: string[],
    name?: string,
    mode?: string,
  ): Promise<unknown> {
    return this.request("POST", "verify/bulk", {
      body: { emails, ...(name && { name }), ...(mode && { mode }) },
      idempotencyKey: randomUUID(),
    });
  }

  async getVerifyJobStatus(
    jobId: number,
    params?: { page?: number; per_page?: number; status?: string; search?: string },
  ): Promise<unknown> {
    return this.request("GET", `verify/bulk/${jobId}`, {
      query: params as Record<string, unknown>,
    });
  }

  async getVerifyCredits(): Promise<unknown> {
    return this.request("GET", "verify/credits");
  }

  async getVerifyJobs(
    params?: { page?: number; per_page?: number; status?: string },
  ): Promise<unknown> {
    return this.request("GET", "verify/bulk", {
      query: params as Record<string, unknown>,
    });
  }

  async cancelVerifyJob(jobId: number): Promise<unknown> {
    return this.request("POST", `verify/bulk/${jobId}/cancel`);
  }

  async deleteVerifyJob(jobId: number): Promise<unknown> {
    return this.request("DELETE", `verify/bulk/${jobId}`);
  }

  async getVerifyJobDownload(
    jobId: number,
    filter?: string,
  ): Promise<unknown> {
    return this.request("GET", `verify/bulk/${jobId}/download`, {
      query: { filter: filter ?? "all" },
    });
  }

  // --- Cloudflare ---

  async validateCloudflareToken(apiToken: string): Promise<unknown> {
    return this.request("POST", "cloudflare/validate-token", {
      body: { api_token: apiToken },
    });
  }

  async listCloudflareZones(apiToken: string): Promise<unknown> {
    return this.request("POST", "cloudflare/zones", {
      body: { api_token: apiToken },
    });
  }

  async connectCloudflareDomains(
    apiToken: string,
    selected: Array<{ zone_id: string; zone_name: string; trekmail_domain_id: number | null }>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "cloudflare/connect", {
      body: { api_token: apiToken, selected },
      idempotencyKey,
    });
  }

  async previewCloudflareDns(domainIds: number[]): Promise<unknown> {
    return this.request("POST", "cloudflare/preview", {
      body: { domain_ids: domainIds },
    });
  }

  async applyCloudflareDns(
    domainIds: number[],
    confirmedConflicts?: Record<string, string[]>,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", "cloudflare/apply", {
      body: {
        domain_ids: domainIds,
        ...(confirmedConflicts ? { confirmed_conflicts: confirmedConflicts } : {}),
      },
      idempotencyKey,
    });
  }

  async listCloudflareTokens(): Promise<unknown> {
    return this.request("GET", "cloudflare/tokens");
  }

  async deleteCloudflareToken(tokenId: number): Promise<unknown> {
    return this.request("DELETE", `cloudflare/tokens/${tokenId}`);
  }

  // --- Core Request ---

  private async request(
    method: string,
    path: string,
    opts: {
      query?: Record<string, unknown>;
      body?: Record<string, unknown>;
      idempotencyKey?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<unknown> {
    const url = new URL(`/api/v1/${path}`, this.baseUrl);

    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "User-Agent": this.userAgent,
      "X-Request-Id": randomUUID(),
      ...opts.headers,
    };

    if (opts.body) {
      headers["Content-Type"] = "application/json";
    }

    if (opts.idempotencyKey && (method === "POST" || method === "PUT" || method === "DELETE")) {
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }

    // GET requests and requests with idempotency keys are safe to retry on timeout
    const isIdempotent = method === "GET" || method === "HEAD" || !!opts.idempotencyKey;

    return withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.timeoutMs,
      );

      try {
        const response = await fetch(url.toString(), {
          method,
          headers,
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });

        const text = await response.text();
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }

        if (!response.ok) {
          throw TrekMailApiError.fromResponse(
            response.status,
            (data as Record<string, unknown>) ?? {},
          );
        }

        return data;
      } catch (error) {
        if (error instanceof TrekMailApiError) throw error;

        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          throw new TrekMailClientError(
            `Request timed out after ${this.timeoutMs}ms: ${method} ${path}`,
            error,
          );
        }

        if (error instanceof TypeError) {
          throw error; // Let retry handle network TypeErrors
        }

        throw new TrekMailClientError(
          `Request failed: ${method} ${path}`,
          error,
        );
      } finally {
        clearTimeout(timeout);
      }
    }, { idempotent: isIdempotent });
  }
}
