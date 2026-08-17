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
  status?: string;
}

export interface CreateMailboxParams {
  domain_id: number;
  local_part: string;
  display_name?: string;
  /** Optional dedicated allocation in MB; omit for shared pool. */
  storage_allocation_mb?: number;
}

export interface CreateInviteParams {
  domain_id: number;
  local_part: string;
  recipient_email: string;
  expires_in_hours?: number;
  /** Optional dedicated allocation in MB; omit for shared pool. */
  storage_allocation_mb?: number;
}

export interface AppleMailProfileFile {
  file_name: string;
  media_type: string;
  encoding: "base64";
  content_base64: string;
  password_included: false;
}

export interface CreateInvitesBulkParams {
  domain_id: number;
  items: Array<{
    local_part: string;
    recipient_email: string;
    /** Optional target domain for this item, overriding the batch domain_id. */
    domain_id?: number;
    /** Optional dedicated allocation in MB; omit for shared pool. */
    storage_allocation_mb?: number;
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
  external_account_id?: number;
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
  // Audit finding #17: target_password removed. The API ignores it
  // (Dovecot uses a master-user; MigrationOrchestrationService hard-
  // codes target_password=null). Listing it here misled MCP agents
  // into thinking they needed to collect a credential they shouldn't.
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
  external_account_id?: number;
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

  async getMessageMe(): Promise<unknown> {
    return this.request("GET", "messages/_me");
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

  // --- Machine payments (MPP) ---
  //
  // Each of these answers 402 with a payment challenge on the first call and
  // completes on a second call carrying a credential. The credential rides in
  // the Payment-Authorization header, NOT in Authorization, which is already
  // holding the bearer token that says which account is buying.
  //
  // Two credential types, not interchangeable: a shared payment token (spt_)
  // for one-off charges, a Stripe PaymentMethod (pm_) for subscriptions. A
  // shared payment token is consumed by its first charge and cannot back
  // recurring billing.

  async agentTopUpCredits(
    quantity: number,
    credential?: string,
    currency?: string,
  ): Promise<unknown> {
    return this.request("POST", "agent/verifier-credits/topup", {
      body: { quantity, ...(currency ? { currency } : {}) },
      headers: credential ? { "Payment-Authorization": credential } : undefined,
    });
  }

  async agentSubscribePlan(
    plan: string,
    period: string,
    credential?: string,
  ): Promise<unknown> {
    return this.request("POST", "agent/subscription", {
      body: { plan, period },
      headers: credential ? { "Payment-Authorization": credential } : undefined,
    });
  }

  async agentSubscribeDriveAddon(
    sizeGb: number,
    period: string,
    credential?: string,
  ): Promise<unknown> {
    return this.request("POST", "agent/drive-addon", {
      body: { size_gb: sizeGb, period },
      headers: credential ? { "Payment-Authorization": credential } : undefined,
    });
  }

  async agentSubscribeWhiteLabel(
    period: string,
    credential?: string,
  ): Promise<unknown> {
    return this.request("POST", "agent/white-label", {
      body: { period },
      headers: credential ? { "Payment-Authorization": credential } : undefined,
    });
  }

  async agentReissueKey(): Promise<unknown> {
    return this.request("POST", "agent/key/reissue", { body: {} });
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
    mailHosting?: "trekmail" | "external",
  ): Promise<unknown> {
    return this.request("POST", "domains", {
      body: mailHosting ? { name, mail_hosting: mailHosting } : { name },
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

  async listForwardingAddresses(domainId: number): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/forwarding-addresses`);
  }

  async getForwardingAddressLog(
    domainId: number,
    forwardingAddressId: number,
    limit?: number,
  ): Promise<unknown> {
    const query = limit === undefined ? "" : `?limit=${limit}`;
    return this.request(
      "GET",
      `domains/${domainId}/forwarding-addresses/${forwardingAddressId}/log${query}`,
    );
  }

  async createForwardingAddress(
    domainId: number,
    localPart: string,
    recipients: string[],
    isActive: boolean,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `domains/${domainId}/forwarding-addresses`, {
      body: { local_part: localPart, recipients, is_active: isActive },
      idempotencyKey,
    });
  }

  async updateForwardingAddress(
    domainId: number,
    addressId: number,
    body: { recipients?: string[]; is_active?: boolean },
  ): Promise<unknown> {
    return this.request(
      "PATCH",
      `domains/${domainId}/forwarding-addresses/${addressId}`,
      { body },
    );
  }

  async deleteForwardingAddress(
    domainId: number,
    addressId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request(
      "DELETE",
      `domains/${domainId}/forwarding-addresses/${addressId}`,
      { idempotencyKey },
    );
  }

  async updateDomainMailHosting(
    domainId: number,
    mailHosting: "trekmail" | "external",
    confirmMailboxesStopReceiving?: boolean,
  ): Promise<unknown> {
    return this.request("PATCH", `domains/${domainId}/mail-hosting`, {
      body: {
        mail_hosting: mailHosting,
        ...(confirmMailboxesStopReceiving
          ? { confirm_mailboxes_stop_receiving: true }
          : {}),
      },
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

  async getDomainSignature(domainId: number): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/signature`);
  }

  async updateDomainSignature(
    domainId: number,
    body: {
      signature_mode: "off" | "default" | "enforced";
      signature_position?: "before_reply" | "after_reply";
      signature_html?: string | null;
    },
  ): Promise<unknown> {
    return this.request("PATCH", `domains/${domainId}/signature`, { body });
  }

  // --- Per-domain Branding / White Label Lite ---

  async getDomainBranding(domainId: number): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/branding`);
  }

  async setDomainBranding(
    domainId: number,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.request("PATCH", `domains/${domainId}/branding`, { body });
  }

  async verifyDomainBrandingDns(domainId: number): Promise<unknown> {
    return this.request("POST", `domains/${domainId}/branding/verify-dns`, {});
  }

  async createBrandingPreview(domainId: number): Promise<unknown> {
    return this.request("POST", `domains/${domainId}/branding/preview`, {});
  }

  async removeDomainBranding(
    domainId: number,
    scope?: "domain" | "all",
  ): Promise<unknown> {
    return this.request("DELETE", `domains/${domainId}/branding`, {
      query: scope ? { scope } : undefined,
    });
  }

  async setDomainBrandLogo(
    domainId: number,
    slot: "light" | "dark" | "favicon",
    contentBase64: string,
  ): Promise<unknown> {
    return this.request("PUT", `domains/${domainId}/branding/logo/${slot}`, {
      body: { content_base64: contentBase64 },
    });
  }

  async removeDomainBrandLogo(
    domainId: number,
    slot: "light" | "dark" | "favicon",
  ): Promise<unknown> {
    return this.request("DELETE", `domains/${domainId}/branding/logo/${slot}`, {});
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

  async getMailClientSetup(id: number, locale?: string): Promise<unknown> {
    return this.request("GET", `mailboxes/${id}/client-setup`, {
      query: locale ? { lang: locale } : undefined,
    });
  }

  async getAppleMailProfile(
    id: number,
    locale?: string,
  ): Promise<AppleMailProfileFile> {
    return this.requestBinary(
      `mailboxes/${id}/apple-mail-profile`,
      locale ? { lang: locale } : undefined,
    );
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

  async updateMailbox(
    mailboxId: number,
    fields: {
      display_name?: string | null;
      conversation_view?: boolean;
      drive_access?: "full" | "attachments_only" | "disabled";
    },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PATCH", `mailboxes/${mailboxId}`, {
      body: fields,
      idempotencyKey,
    });
  }

  async setMailboxesDriveAccess(
    body: {
      drive_access: "full" | "attachments_only" | "disabled";
      mailbox_ids?: number[];
      domain_id?: number;
      all?: boolean;
    },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "mailboxes:drive-access", {
      body,
      idempotencyKey,
    });
  }

  async suspendMailboxLogin(
    mailboxId: number,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}:suspend-login`, {
      body: reason === undefined ? {} : { reason },
      idempotencyKey,
    });
  }

  async resumeMailboxLogin(
    mailboxId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}:resume-login`, {
      idempotencyKey,
    });
  }

  async setMailboxesLoginAccess(
    body: {
      login_suspended: boolean;
      reason?: string;
      mailbox_ids?: number[];
      domain_id?: number;
      all?: boolean;
    },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "mailboxes:login-access", {
      body,
      idempotencyKey,
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
    items: Array<{
      domain_id: number;
      local_part: string;
      password?: string;
      /** Optional dedicated allocation in MB; omit for shared pool. */
      storage_allocation_mb?: number;
    }>,
    idempotencyKey: string,
    passwordMode?: "user_supplied" | "generated_one_time",
  ): Promise<unknown> {
    return this.request("POST", "mailboxes:bulk", {
      body: {
        items,
        ...(passwordMode ? { password_mode: passwordMode } : {}),
      },
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
    return this.request("DELETE", `mailboxes/${mailboxId}/rules/${ruleId}`, {
      idempotencyKey: randomUUID(),
    });
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

  // --- Shared mailbox members ---

  async listSharedMailboxMembers(mailboxId: number): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/members`);
  }

  async addSharedMailboxMember(
    mailboxId: number,
    params: { member_mailbox_id: number; can_send?: boolean },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}/members`, {
      body: { ...params },
      idempotencyKey,
    });
  }

  async updateSharedMailboxMember(
    mailboxId: number,
    memberId: number,
    params: { can_send: boolean; custom_label?: string },
  ): Promise<unknown> {
    return this.request("PATCH", `mailboxes/${mailboxId}/members/${memberId}`, {
      body: { ...params },
    });
  }

  async removeSharedMailboxMember(
    mailboxId: number,
    memberId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("DELETE", `mailboxes/${mailboxId}/members/${memberId}`, {
      idempotencyKey,
    });
  }

  // --- Shared mailbox lifecycle ---

  async createSharedMailbox(
    params: {
      domain_id: number;
      local_part: string;
      display_name: string;
      member_mailbox_ids: number[];
      storage_shared?: boolean;
      storage_mb?: number;
    },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "shared-mailboxes", {
      body: { ...params },
      idempotencyKey,
    });
  }

  async convertMailboxToShared(
    mailboxId: number,
    params: { member_mailbox_ids: number[] },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}/convert-to-shared`, {
      body: { ...params },
      idempotencyKey,
    });
  }

  async convertSharedMailboxToRegular(
    mailboxId: number,
    params: { password: string },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}/convert-to-regular`, {
      body: { ...params },
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

  async restoreMailbox(
    mailboxId: number,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `mailboxes/${mailboxId}:restore`, {
      idempotencyKey,
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

  async cancelBulkMigration(id: number): Promise<unknown> {
    return this.request("POST", `migrations/bulk/${id}:cancel`);
  }

  async retryBulkMigration(id: number): Promise<unknown> {
    return this.request("POST", `migrations/bulk/${id}:retry`);
  }

  async resumeBulkMigration(id: number): Promise<unknown> {
    return this.request("POST", `migrations/bulk/${id}:resume`);
  }

  async deleteBulkMigration(id: number): Promise<unknown> {
    return this.request("DELETE", `migrations/bulk/${id}`, {
      idempotencyKey: randomUUID(),
    });
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

  // Account-wide default outbound route (Domain-SMTP).
  async getAccountSmtpDefault(): Promise<unknown> {
    return this.request("GET", "smtp/default");
  }

  async setAccountSmtpDefault(
    params: {
      smtp_mode: string;
      smtp_connection_id?: number;
      apply_to_all?: boolean;
    },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PUT", "smtp/default", {
      body: { ...params },
      idempotencyKey,
    });
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

  // --- Per-domain SMTP (Domain-SMTP feature) ---

  async getDomainSmtp(domainId: number): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/smtp`);
  }

  async setDomainSmtp(
    domainId: number,
    body: { smtp_mode: string; smtp_connection_id?: number | null },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PUT", `domains/${domainId}/smtp`, { body, idempotencyKey });
  }

  async listDomainSmtpProfiles(domainId: number): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/smtp/profiles`);
  }

  async getDomainSmtpProfileUsage(domainId: number, profileId: number): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/smtp/profiles/${profileId}/usage`);
  }

  async createDomainSmtpProfile(
    domainId: number,
    body: { name: string; host: string; port: number; encryption: string; username: string; password: string },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `domains/${domainId}/smtp/profiles`, { body, idempotencyKey });
  }

  async updateDomainSmtpProfile(
    domainId: number,
    profileId: number,
    body: { name: string; host: string; port: number; encryption: string; username: string; password?: string },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("PUT", `domains/${domainId}/smtp/profiles/${profileId}`, { body, idempotencyKey });
  }

  async deleteDomainSmtpProfile(domainId: number, profileId: number, idempotencyKey: string): Promise<unknown> {
    return this.request("DELETE", `domains/${domainId}/smtp/profiles/${profileId}`, { idempotencyKey });
  }

  async testDomainSmtp(
    domainId: number,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `domains/${domainId}/smtp:test`, { body, idempotencyKey });
  }

  async getDomainSmtpTestStatus(domainId: number, jobId: string): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/smtp:test-status/${jobId}`);
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
    params?: { folder?: string; external_account_id?: number },
  ): Promise<unknown> {
    return this.request("PATCH", `messages/${uid}`, {
      body: { flags, folder: params?.folder, external_account_id: params?.external_account_id },
    });
  }

  async deleteMessage(uid: number, params?: { folder?: string; external_account_id?: number }): Promise<unknown> {
    return this.request("DELETE", `messages/${uid}`, {
      query: params ? { ...params } : undefined,
      idempotencyKey: randomUUID(),
    });
  }

  async moveMessage(
    uid: number,
    params: { folder?: string; destination: string; external_account_id?: number },
  ): Promise<unknown> {
    return this.request("POST", `messages/${uid}:move`, {
      body: {
        folder: params.folder,
        destination: params.destination,
        external_account_id: params.external_account_id,
      },
    });
  }

  async listFolders(params?: { external_account_id?: number }): Promise<unknown> {
    return this.request("GET", "messages/folders", {
      query: params ? { ...params } : undefined,
    });
  }

  async downloadAttachment(
    uid: number,
    index: number,
    params?: { folder?: string; external_account_id?: number },
  ): Promise<unknown> {
    return this.request("GET", `messages/${uid}/attachments/${index}`, {
      query: params ? { ...params } : undefined,
    });
  }

  async downloadAllAttachments(
    uid: number,
    params?: { folder?: string; external_account_id?: number },
  ): Promise<unknown> {
    return this.request("GET", `messages/${uid}/attachments`, {
      query: params ? { ...params } : undefined,
    });
  }

  async getRawMessage(
    uid: number,
    params?: { folder?: string; external_account_id?: number },
  ): Promise<unknown> {
    return this.request("GET", `messages/${uid}/raw`, {
      query: params ? { ...params } : undefined,
    });
  }

  async createFolder(name: string, parent?: string): Promise<unknown> {
    return this.request("POST", "messages/folders", {
      body: parent ? { name, parent } : { name },
    });
  }

  async renameFolder(path: string, name: string): Promise<unknown> {
    return this.request("PATCH", `messages/folders/${encodeURIComponent(path)}`, {
      body: { name },
    });
  }

  async deleteFolder(path: string): Promise<unknown> {
    return this.request("DELETE", `messages/folders/${encodeURIComponent(path)}`, {
      idempotencyKey: randomUUID(),
    });
  }

  // Both draft routes sit behind the message-API idempotency middleware, which
  // refuses any write with no Idempotency-Key — so omitting it here made both
  // tools fail 100% of the time with missing_idempotency_key, and no caller
  // could work around it (ticket #354).
  //
  // The default is random, NOT the deterministic idempotencyKey() hash used by
  // send_message. Deterministic is right there because a repeated identical
  // send is almost always an accident. Drafts are the opposite: the middleware
  // replays the stored response for a repeated key, so a hash of the body would
  // make a second identical draft silently return the first one's UID, and
  // updating a draft BACK to earlier content would return the old response
  // without performing the update at all. Callers that genuinely want
  // retry-dedup pass their own key.
  async saveDraft(
    body: Record<string, unknown>,
    idempotencyKey: string = randomUUID(),
  ): Promise<unknown> {
    return this.request("POST", "messages/drafts", { body, idempotencyKey });
  }

  async updateDraft(
    uid: number,
    body: Record<string, unknown>,
    idempotencyKey: string = randomUUID(),
  ): Promise<unknown> {
    return this.request("PUT", `messages/drafts/${uid}`, {
      body,
      idempotencyKey,
    });
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
    external_account_id?: number;
  }): Promise<unknown> {
    return this.request("POST", "messages/bulk", { body: params });
  }

  async emptyFolder(folder: string): Promise<unknown> {
    return this.request("POST", "messages/folders:empty", {
      body: { folder },
    });
  }

  // --- Reply / Forward ---

  async getReply(uid: number, params?: { folder?: string; external_account_id?: number }): Promise<unknown> {
    return this.request("GET", `messages/${uid}/reply`, {
      query: params ? { ...params } : undefined,
    });
  }

  async getReplyAll(uid: number, params?: { folder?: string; external_account_id?: number }): Promise<unknown> {
    return this.request("GET", `messages/${uid}/reply-all`, {
      query: params ? { ...params } : undefined,
    });
  }

  async getForward(uid: number, params?: { folder?: string; external_account_id?: number }): Promise<unknown> {
    return this.request("GET", `messages/${uid}/forward`, {
      query: params ? { ...params } : undefined,
    });
  }

  // --- Contact Groups ---

  async listContactGroups(): Promise<unknown> {
    return this.request("GET", "messages/contact-groups");
  }

  async listContactGroupMembers(
    id: number,
    params?: { per_page?: number; page?: number },
  ): Promise<unknown> {
    return this.request("GET", `messages/contact-groups/${id}/members`, {
      query: params ? { ...params } : undefined,
    });
  }

  async createContactGroup(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/contact-groups", { body });
  }

  async updateContactGroup(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `messages/contact-groups/${id}`, { body });
  }

  async deleteContactGroup(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/contact-groups/${id}`, {
      idempotencyKey: randomUUID(),
    });
  }

  async addContactGroupMembers(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", `messages/contact-groups/${id}/members`, { body });
  }

  async removeContactGroupMembers(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("DELETE", `messages/contact-groups/${id}/members`, {
      body,
      idempotencyKey: randomUUID(),
    });
  }

  // --- Identities ---

  async listIdentities(params?: { external_account_id?: number }): Promise<unknown> {
    return this.request("GET", "messages/identities", {
      query: params ? { ...params } : undefined,
    });
  }

  async createIdentity(body: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
    return this.request("POST", "messages/identities", { body, idempotencyKey });
  }

  async updateIdentity(id: number, body: Record<string, unknown>, idempotencyKey?: string): Promise<unknown> {
    return this.request("PATCH", `messages/identities/${id}`, { body, idempotencyKey });
  }

  async deleteIdentity(id: number, externalAccountId?: number): Promise<unknown> {
    return this.request("DELETE", `messages/identities/${id}`, {
      body: externalAccountId ? { external_account_id: externalAccountId } : undefined,
      idempotencyKey: randomUUID(),
    });
  }

  async setReplyFromPolicy(
    replyFromPolicy: "recipient" | "default",
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("PATCH", "messages/identities/reply-policy", {
      body: { reply_from_policy: replyFromPolicy },
      idempotencyKey,
    });
  }

  // --- Connected external accounts (Gmail/Yahoo/iCloud/custom IMAP) ---

  async listExternalAccounts(): Promise<unknown> {
    return this.request("GET", "messages/external-accounts");
  }

  async detectExternalAccount(email: string): Promise<unknown> {
    return this.request("POST", "messages/external-accounts/detect", { body: { email } });
  }

  async testExternalAccount(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/external-accounts/test", { body });
  }

  async createExternalAccount(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/external-accounts", {
      body,
      idempotencyKey: randomUUID(),
    });
  }

  async updateExternalAccount(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `messages/external-accounts/${id}`, {
      body,
      idempotencyKey: randomUUID(),
    });
  }

  async testSavedExternalAccount(id: number): Promise<unknown> {
    return this.request("POST", `messages/external-accounts/${id}/test`, { body: {} });
  }

  async deleteExternalAccount(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/external-accounts/${id}`, {
      idempotencyKey: randomUUID(),
    });
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
    return this.request("DELETE", `messages/templates/${id}`, {
      idempotencyKey: randomUUID(),
    });
  }

  // --- Blocked Senders ---

  async listBlockedSenders(): Promise<unknown> {
    return this.request("GET", "messages/blocked-senders");
  }

  async blockSender(body: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "messages/blocked-senders", { body });
  }

  async unblockSender(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/blocked-senders/${id}`, {
      idempotencyKey: randomUUID(),
    });
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

  async listScheduled(params?: { cursor?: string; per_page?: number }): Promise<unknown> {
    return this.request("GET", "messages/scheduled", {
      query: params ? { ...params } : undefined,
    });
  }

  async cancelScheduled(id: number): Promise<unknown> {
    return this.request("DELETE", `messages/scheduled/${id}`, {
      idempotencyKey: randomUUID(),
    });
  }

  async rescheduleMessage(id: number, body: Record<string, unknown>): Promise<unknown> {
    return this.request("PATCH", `messages/scheduled/${id}`, {
      body,
    });
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
    return this.request("DELETE", `messages/contacts/${id}`, {
      idempotencyKey: randomUUID(),
    });
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

  async listCalendarEvents(params: { start: string; end: string; per_page?: number; cursor?: string }): Promise<unknown> {
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
    return this.request("DELETE", `messages/calendar/events/${id}`, {
      idempotencyKey: randomUUID(),
    });
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
    return this.request("DELETE", `message-tokens/${tokenId}`, {
      idempotencyKey: randomUUID(),
    });
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

  // --- Outbound Deliverability & Bounces ---

  async getDomainDeliverability(
    domainId: number,
    days?: number,
  ): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/deliverability`, {
      query: { days: days ?? 30 },
    });
  }

  async listDomainBounces(
    domainId: number,
    opts: {
      days?: number;
      type?: "hard" | "soft" | "all";
      recipient?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<unknown> {
    return this.request("GET", `domains/${domainId}/bounces`, {
      query: {
        days: opts.days ?? 30,
        ...(opts.type ? { type: opts.type } : {}),
        ...(opts.recipient ? { recipient: opts.recipient } : {}),
        limit: opts.limit ?? 50,
        offset: opts.offset ?? 0,
      },
    });
  }

  async listMailboxBounces(
    mailboxId: number,
    opts: {
      days?: number;
      type?: "hard" | "soft" | "all";
      recipient?: string;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<unknown> {
    return this.request("GET", `mailboxes/${mailboxId}/bounces`, {
      query: {
        days: opts.days ?? 30,
        ...(opts.type ? { type: opts.type } : {}),
        ...(opts.recipient ? { recipient: opts.recipient } : {}),
        limit: opts.limit ?? 50,
        offset: opts.offset ?? 0,
      },
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
    return this.request("DELETE", `verify/bulk/${jobId}`, {
      idempotencyKey: randomUUID(),
    });
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

  async previewCloudflareDns(
    domainIds: number[],
    includedRecords?: Record<string, string[]>,
  ): Promise<unknown> {
    return this.request("POST", "cloudflare/preview", {
      body: {
        domain_ids: domainIds,
        ...(includedRecords ? { included_records: includedRecords } : {}),
      },
    });
  }

  async applyCloudflareDns(
    domainIds: number[],
    confirmedConflicts?: Record<string, string[]>,
    idempotencyKey?: string,
    includedRecords?: Record<string, string[]>,
  ): Promise<unknown> {
    return this.request("POST", "cloudflare/apply", {
      body: {
        domain_ids: domainIds,
        ...(confirmedConflicts ? { confirmed_conflicts: confirmedConflicts } : {}),
        ...(includedRecords ? { included_records: includedRecords } : {}),
      },
      idempotencyKey,
    });
  }

  async listCloudflareTokens(): Promise<unknown> {
    return this.request("GET", "cloudflare/tokens");
  }

  async deleteCloudflareToken(tokenId: number): Promise<unknown> {
    return this.request("DELETE", `cloudflare/tokens/${tokenId}`, {
      idempotencyKey: randomUUID(),
    });
  }

  // --- Drive (PR #8) ---
  //
  // {space} URL segment accepts "account" | "mailbox:N" | "<spaceId>" —
  // see EnforceDriveSpaceAccess middleware. Methods accept it as a
  // free-form string so callers don't have to think about the encoding.

  async listDriveSpaces(): Promise<unknown> {
    return this.request("GET", "drive/spaces");
  }

  async getDriveStorage(): Promise<unknown> {
    return this.request("GET", "drive/storage");
  }

  async getDriveSpaceUsage(space: string): Promise<unknown> {
    return this.request("GET", `drive/spaces/${encodeURIComponent(space)}/usage`);
  }

  async listDriveFolder(
    space: string,
    folderId?: number | null,
    params?: { sort?: string; dir?: string; per_page?: number; cursor?: string },
  ): Promise<unknown> {
    const path = folderId
      ? `drive/spaces/${encodeURIComponent(space)}/folders/${folderId}`
      : `drive/spaces/${encodeURIComponent(space)}/folders`;
    return this.request("GET", path, { query: params ? { ...params } : undefined });
  }

  async getDriveFolderTree(space: string): Promise<unknown> {
    return this.request("GET", `drive/spaces/${encodeURIComponent(space)}/folder-tree`);
  }

  async getDriveAllIds(space: string, folderId?: number | null): Promise<unknown> {
    const path = folderId
      ? `drive/spaces/${encodeURIComponent(space)}/folders/${folderId}/all-ids`
      : `drive/spaces/${encodeURIComponent(space)}/all-ids`;
    return this.request("GET", path);
  }

  async listDriveTrash(
    space: string,
    params?: { per_page?: number; cursor?: string },
  ): Promise<unknown> {
    return this.request("GET", `drive/spaces/${encodeURIComponent(space)}/trash`, {
      query: params ? { ...params } : undefined,
    });
  }

  async getDriveFile(fileId: number): Promise<unknown> {
    return this.request("GET", `drive/files/${fileId}`);
  }

  async getDriveFileDownload(fileId: number): Promise<unknown> {
    return this.request("GET", `drive/files/${fileId}/download`);
  }

  async createDriveFolder(
    space: string,
    name: string,
    parentId?: number | null,
    color?: string,
    isShared?: boolean,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/spaces/${encodeURIComponent(space)}/folders`, {
      body: {
        name,
        ...(parentId !== undefined ? { parent_id: parentId } : {}),
        ...(color ? { color } : {}),
        ...(isShared !== undefined ? { is_shared: isShared } : {}),
      },
      idempotencyKey,
    });
  }

  async updateDriveFolder(
    folderId: number,
    changes: { name?: string; color?: string | null },
  ): Promise<unknown> {
    return this.request("PATCH", `drive/folders/${folderId}`, { body: changes });
  }

  async moveDriveFolder(
    folderId: number,
    parentId: number | null,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/folders/${folderId}:move`, {
      body: { parent_id: parentId },
      idempotencyKey,
    });
  }

  async trashDriveFolder(folderId: number): Promise<unknown> {
    return this.request("DELETE", `drive/folders/${folderId}`, {
      idempotencyKey: randomUUID(),
    });
  }

  async restoreDriveFolder(folderId: number, idempotencyKey?: string): Promise<unknown> {
    return this.request("POST", `drive/folders/${folderId}:restore`, { idempotencyKey });
  }

  async purgeDriveFolder(folderId: number): Promise<unknown> {
    return this.request("DELETE", `drive/folders/${folderId}:purge`, {
      idempotencyKey: randomUUID(),
    });
  }

  async shareDriveFolderWithAccount(folderId: number, idempotencyKey?: string): Promise<unknown> {
    return this.request("POST", `drive/folders/${folderId}:share-with-account`, { idempotencyKey });
  }

  async stopSharingDriveFolder(folderId: number, idempotencyKey?: string): Promise<unknown> {
    return this.request("POST", `drive/folders/${folderId}:stop-sharing`, { idempotencyKey });
  }

  async renameDriveFile(fileId: number, name: string): Promise<unknown> {
    return this.request("PATCH", `drive/files/${fileId}`, { body: { name } });
  }

  async moveDriveFile(
    fileId: number,
    folderId: number | null,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/files/${fileId}:move`, {
      body: { folder_id: folderId },
      idempotencyKey,
    });
  }

  async trashDriveFile(fileId: number): Promise<unknown> {
    return this.request("DELETE", `drive/files/${fileId}`, {
      idempotencyKey: randomUUID(),
    });
  }

  async restoreDriveFile(fileId: number, idempotencyKey?: string): Promise<unknown> {
    return this.request("POST", `drive/files/${fileId}:restore`, { idempotencyKey });
  }

  async purgeDriveFile(fileId: number): Promise<unknown> {
    return this.request("DELETE", `drive/files/${fileId}:purge`, {
      idempotencyKey: randomUUID(),
    });
  }

  async emptyDriveTrash(space: string): Promise<unknown> {
    return this.request("DELETE", `drive/spaces/${encodeURIComponent(space)}/trash`, {
      idempotencyKey: randomUUID(),
    });
  }

  async bulkDriveTrash(
    space: string,
    fileIds: number[],
    folderIds: number[],
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/spaces/${encodeURIComponent(space)}/bulk:trash`, {
      body: { file_ids: fileIds, folder_ids: folderIds },
      idempotencyKey,
    });
  }

  async bulkDriveRestore(
    space: string,
    fileIds: number[],
    folderIds: number[],
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/spaces/${encodeURIComponent(space)}/bulk:restore`, {
      body: { file_ids: fileIds, folder_ids: folderIds },
      idempotencyKey,
    });
  }

  async bulkDriveMove(
    space: string,
    fileIds: number[],
    folderIds: number[],
    targetFolderId: number | null,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/spaces/${encodeURIComponent(space)}/bulk:move`, {
      body: { file_ids: fileIds, folder_ids: folderIds, target_folder_id: targetFolderId },
      idempotencyKey,
    });
  }

  async bulkDrivePurge(
    space: string,
    fileIds: number[],
    folderIds: number[],
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/spaces/${encodeURIComponent(space)}/bulk:purge`, {
      body: { file_ids: fileIds, folder_ids: folderIds },
      idempotencyKey,
    });
  }

  async createDriveShareLink(
    fileId: number,
    options: { expires_at?: string; max_downloads?: number },
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/files/${fileId}/share-links`, {
      body: options,
      idempotencyKey,
    });
  }

  async listDriveShareLinks(fileId: number): Promise<unknown> {
    return this.request("GET", `drive/files/${fileId}/share-links`);
  }

  async revokeDriveShareLink(linkId: number): Promise<unknown> {
    return this.request("DELETE", `drive/share-links/${linkId}`, {
      idempotencyKey: randomUUID(),
    });
  }

  async initiateDriveUpload(
    space: string,
    name: string,
    sizeBytes: number,
    folderId?: number | null,
    clientMime?: string,
    idempotencyKey?: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/spaces/${encodeURIComponent(space)}/uploads:initiate`, {
      body: {
        name,
        size_bytes: sizeBytes,
        ...(folderId !== undefined ? { folder_id: folderId } : {}),
        ...(clientMime ? { client_mime: clientMime } : {}),
      },
      idempotencyKey,
    });
  }

  async completeDriveUpload(
    fileId: number,
    parts?: Array<{ part_number: number; etag: string }>,
  ): Promise<unknown> {
    return this.request("POST", `drive/uploads/${fileId}:complete`, {
      body: parts ? { parts } : {},
    });
  }

  async refreshDriveUploadParts(fileId: number, partNumbers: number[]): Promise<unknown> {
    return this.request("POST", `drive/uploads/${fileId}:refresh-parts`, {
      body: { part_numbers: partNumbers },
    });
  }

  async abortDriveUpload(fileId: number): Promise<unknown> {
    return this.request("POST", `drive/uploads/${fileId}:abort`);
  }

  async getDriveAddon(): Promise<unknown> {
    return this.request("GET", "drive/addon");
  }

  async getDriveAddonPricing(currency?: string): Promise<unknown> {
    return this.request("GET", "drive/addon/pricing", {
      query: currency ? { currency } : undefined,
    });
  }

  async getDriveAddonCancellationPreview(): Promise<unknown> {
    return this.request("GET", "drive/addon/cancellation-preview");
  }

  // ─── Drive Sync Devices (drive:devices:read / drive:devices:write) ───

  async listDriveDevices(): Promise<unknown> {
    return this.request("GET", "drive/devices");
  }

  async createDriveDevice(
    body: {
      label: string;
      scopes: string[];
      mailbox_id?: number | null;
      expires_in_days?: number | null;
    },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", "drive/devices", { body, idempotencyKey });
  }

  async revokeDriveDevice(deviceId: number, idempotencyKey: string): Promise<unknown> {
    return this.request("DELETE", `drive/devices/${deviceId}`, { idempotencyKey });
  }

  async rotateDriveDevice(
    deviceId: number,
    body: { expires_in_days?: number | null },
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.request("POST", `drive/devices/${deviceId}:rotate`, { body, idempotencyKey });
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

    if (opts.idempotencyKey && (method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE")) {
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
          const snippet = text.slice(0, 200);
          data = {
            error: {
              code: "non_json_response",
              message: `API returned a non-JSON response with HTTP ${response.status}.`,
              hint: snippet ? `First 200 chars: ${snippet}` : "Response body was empty.",
            },
          };
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

  /**
   * Download a small API file and make it MCP-safe. Both stdio and hosted
   * Streamable HTTP tools return structured JSON/text, so a raw HTTP download
   * is represented as Base64 with its original filename and media type.
   */
  private async requestBinary(
    path: string,
    query?: Record<string, unknown>,
  ): Promise<AppleMailProfileFile> {
    const url = new URL(`/api/v1/${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    return withRetry(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/x-apple-aspen-config, application/json",
            "User-Agent": this.userAgent,
            "X-Request-Id": randomUUID(),
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          let body: Record<string, unknown>;
          try {
            body = JSON.parse(text) as Record<string, unknown>;
          } catch {
            body = {
              error: {
                code: "non_json_response",
                message: `API returned a non-JSON response with HTTP ${response.status}.`,
                hint: text
                  ? `First 200 chars: ${text.slice(0, 200)}`
                  : "Response body was empty.",
              },
            };
          }
          throw TrekMailApiError.fromResponse(response.status, body);
        }

        const disposition = response.headers.get("content-disposition") ?? "";
        const filenameMatch = disposition.match(/filename="([^"]+)"/i);
        const mediaType = (response.headers.get("content-type") ?? "application/octet-stream")
          .split(";", 1)[0]!
          .trim();
        const bytes = Buffer.from(await response.arrayBuffer());

        return {
          file_name: filenameMatch?.[1] ?? `apple-mail-${path.split("/")[1] ?? "profile"}.mobileconfig`,
          media_type: mediaType,
          encoding: "base64",
          content_base64: bytes.toString("base64"),
          password_included: false,
        };
      } catch (error) {
        if (error instanceof TrekMailApiError) throw error;

        if (error instanceof DOMException && error.name === "AbortError") {
          throw new TrekMailClientError(
            `Request timed out after ${this.timeoutMs}ms: GET ${path}`,
            error,
          );
        }

        if (error instanceof TypeError) throw error;

        throw new TrekMailClientError(`Request failed: GET ${path}`, error);
      } finally {
        clearTimeout(timeout);
      }
    }, { idempotent: true });
  }
}
