import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import type { Config } from "../config.js";
import { idempotencyKey } from "../idempotency.js";
import { callApi, errorResult, isPrivateHost } from "./util.js";

export function registerMigrationTools(
  server: McpServer,
  client: TrekMailClient,
  config: Config,
): void {
  // test_migration_connection - safety gate: allowMigration (makes outbound network connection)
  server.registerTool(
    "test_migration_connection",
    {
      title: "Test Migration Connection",
      description: "Test IMAP connection credentials for email migration. Returns folder list with message counts if successful. Requires TREKMAIL_ALLOW_MIGRATION=true.",
      inputSchema: {
        source_host: z.string().max(255).describe("IMAP server hostname"),
        source_port: z.number().int().positive().describe("IMAP server port (usually 993 for SSL)"),
        source_security: z.enum(["ssl", "tls", "none"]).describe("Connection security"),
        source_email: z.string().email().max(255).describe("Source email address"),
        source_username: z.string().max(255).optional().describe("IMAP username (defaults to source_email)"),
        source_password: z.string().max(255).describe("IMAP password or app password"),
        idempotency_key: z.string().optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ source_host, source_port, source_security, source_email, source_username, source_password, idempotency_key }) => {
      if (!config.allowMigration) {
        return errorResult(
          "Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable email migrations via the MCP server.",
        );
      }
      if (isPrivateHost(source_host)) {
        return errorResult("Cannot connect to private/internal network addresses.");
      }
      const idemKey = idempotencyKey("test_migration_connection", { source_host, source_port, source_security, source_email }, idempotency_key);
      return callApi(() => client.testMigrationConnection(
        { source_host, source_port, source_security, source_email, source_username, source_password },
        idemKey,
      ));
    },
  );

  // list_migrations - no safety gate
  server.registerTool(
    "list_migrations",
    {
      title: "List Migrations",
      description: "List email migration jobs for your account. Supports filtering by status and mailbox.",
      inputSchema: {
        status: z.enum(["pending", "validating", "planning", "processing", "completed", "failed", "cancelled"]).optional().describe("Filter by migration status"),
        mailbox_id: z.number().int().positive().optional().describe("Filter by target mailbox ID"),
        page: z.number().int().positive().optional().describe("Page number"),
        per_page: z.number().int().min(1).max(100).optional().describe("Results per page (max 100)"),
      },
    },
    async ({ status, mailbox_id, page, per_page }) => {
      return callApi(() => client.listMigrations({ status, mailbox_id, page, per_page }));
    },
  );

  // get_migration - no safety gate
  server.registerTool(
    "get_migration",
    {
      title: "Get Migration",
      description: "Get detailed status of a specific email migration, including per-folder progress breakdown and polling hint.",
      inputSchema: {
        migration_id: z.number().int().positive().describe("The migration job ID"),
      },
    },
    async ({ migration_id }) => {
      return callApi(() => client.getMigration(migration_id));
    },
  );

  // start_migration - safety gate: allowMigration + confirm_start
  server.registerTool(
    "start_migration",
    {
      title: "Start Email Migration",
      description: "Start migrating emails from a source IMAP server to a TrekMail mailbox. This is a long-running operation. Both TREKMAIL_ALLOW_MIGRATION=true and confirm_start=true are required.",
      inputSchema: {
        mailbox_id: z.number().int().positive().describe("Target TrekMail mailbox ID"),
        provider: z.enum(["gmail", "outlook", "yahoo", "icloud", "generic_imap"]).describe("Source email provider"),
        source_host: z.string().max(255).describe("Source IMAP server hostname"),
        source_port: z.number().int().positive().describe("Source IMAP port (usually 993)"),
        source_security: z.enum(["ssl", "tls", "none"]).describe("Connection security"),
        source_email: z.string().email().max(255).describe("Source email address"),
        source_username: z.string().max(255).optional().describe("IMAP username (defaults to source_email)"),
        source_password: z.string().max(255).describe("Source IMAP password or app password"),
        // Audit finding #17: target_password was previously a required
        // parameter, but the API ignores it — Dovecot uses a master-user
        // and MigrationOrchestrationService hard-codes target_password=null.
        // Removed entirely so agents don't ask the user for credentials
        // they shouldn't be touching.
        selected_folders: z.array(z.string().max(255)).optional().describe("Folders to migrate (empty = all folders)"),
        import_since: z.string().optional().describe("Only import messages from this date (YYYY-MM-DD)"),
        skip_duplicates: z.boolean().optional().describe("Skip messages already in target (default: true)"),
        confirm_start: z.boolean().describe("Must be true to start migration. Safety gate."),
        idempotency_key: z.string().optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ mailbox_id, provider, source_host, source_port, source_security, source_email, source_username, source_password, selected_folders, import_since, skip_duplicates, confirm_start, idempotency_key }) => {
      if (!config.allowMigration) {
        return errorResult(
          "Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable email migrations via the MCP server.",
        );
      }
      if (!confirm_start) {
        return errorResult(
          "Migration not confirmed. Set confirm_start=true to start the email migration.",
        );
      }
      if (isPrivateHost(source_host)) {
        return errorResult("Cannot connect to private/internal network addresses.");
      }
      const idemKey = idempotencyKey("start_migration", { mailbox_id, source_host, source_email }, idempotency_key);
      return callApi(() => client.startMigration(
        { mailbox_id, provider, source_host, source_port, source_security, source_email, source_username, source_password, selected_folders, import_since, skip_duplicates },
        idemKey,
      ));
    },
  );

  // cancel_migration - safety gate: confirm_cancel
  server.registerTool(
    "cancel_migration",
    {
      title: "Cancel Migration",
      description: "Cancel a running email migration. Set confirm_cancel=true to proceed.",
      inputSchema: {
        migration_id: z.number().int().positive().describe("The migration job ID to cancel"),
        confirm_cancel: z.boolean().describe("Must be true to cancel. Safety gate."),
        idempotency_key: z.string().optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ migration_id, confirm_cancel, idempotency_key }) => {
      // No allowMigration gate here — cancel is a safety/abort operation
      // that must always be available (e.g. to stop a runaway migration).
      if (!confirm_cancel) {
        return errorResult("Cancellation not confirmed. Set confirm_cancel=true to cancel the migration.");
      }
      const idemKey = idempotencyKey("cancel_migration", { migration_id }, idempotency_key);
      return callApi(() => client.cancelMigration(migration_id, idemKey));
    },
  );

  // retry_migration - safety gate: confirm_retry
  server.registerTool(
    "retry_migration",
    {
      title: "Retry Migration",
      description: "Retry a failed or cancelled email migration. Set confirm_retry=true to proceed.",
      inputSchema: {
        migration_id: z.number().int().positive().describe("The migration job ID to retry"),
        confirm_retry: z.boolean().describe("Must be true to retry. Safety gate."),
        idempotency_key: z.string().optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ migration_id, confirm_retry, idempotency_key }) => {
      if (!config.allowMigration) {
        return errorResult("Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable.");
      }
      if (!confirm_retry) {
        return errorResult("Retry not confirmed. Set confirm_retry=true to retry the migration.");
      }
      const idemKey = idempotencyKey("retry_migration", { migration_id }, idempotency_key);
      return callApi(() => client.retryMigration(migration_id, idemKey));
    },
  );

  // delete_migration - safety gate: allowMigration + confirm_delete
  server.registerTool(
    "delete_migration",
    {
      title: "Delete Migration Record",
      description: "Delete a completed, failed, or cancelled migration record. Cannot delete running migrations. Both TREKMAIL_ALLOW_MIGRATION=true and confirm_delete=true are required.",
      inputSchema: {
        migration_id: z.number().int().positive().describe("The migration job ID to delete"),
        confirm_delete: z.boolean().describe("Must be true to delete. Safety gate."),
        idempotency_key: z.string().optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ migration_id, confirm_delete, idempotency_key }) => {
      if (!config.allowMigration) {
        return errorResult(
          "Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable email migrations via the MCP server.",
        );
      }
      if (!confirm_delete) {
        return errorResult("Deletion not confirmed. Set confirm_delete=true to delete the migration record.");
      }
      const idemKey = idempotencyKey("delete_migration", { migration_id }, idempotency_key);
      return callApi(() => client.deleteMigration(migration_id, idemKey));
    },
  );

  // ========== BULK MIGRATION TOOLS ==========

  // preview_bulk_migration - safety gate: allowMigration
  server.registerTool(
    "preview_bulk_migration",
    {
      title: "Preview Bulk Migration",
      description: "Validate and preview a bulk migration batch. Returns categorized results showing which rows are valid, invalid, or have warnings. Always run this before start_bulk_migration. Requires TREKMAIL_ALLOW_MIGRATION=true.",
      inputSchema: {
        data: z.string().describe("CSV data: source_email,source_password,destination_email per line"),
        provider: z.enum(["gmail", "outlook", "yahoo", "icloud", "generic_imap"]).optional().describe("Source email provider (applies to all rows)"),
        source_host: z.string().max(255).optional().describe("IMAP host (if provider is generic_imap)"),
        source_port: z.number().int().positive().optional().describe("IMAP port (default 993)"),
        source_security: z.enum(["ssl", "tls", "none"]).optional().describe("Connection security"),
        per_row_server: z.boolean().optional().describe("Each row has its own server settings (6-column CSV)"),
        folder_strategy: z.enum(["all", "standard", "inbox_only"]).optional().describe("Folder strategy (default: all)"),
        import_since: z.string().optional().describe("Only import emails after this date (YYYY-MM-DD)"),
        skip_duplicates: z.boolean().optional().describe("Skip duplicate messages (default: true)"),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => {
      if (!config.allowMigration) {
        return errorResult("Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true.");
      }
      const idemKey = idempotencyKey("preview_bulk_migration", { data_len: params.data.length });
      return callApi(() => client.previewBulkMigration(params, idemKey));
    },
  );

  // start_bulk_migration - safety gate: allowMigration + confirm_start
  server.registerTool(
    "start_bulk_migration",
    {
      title: "Start Bulk Migration",
      description: "Start a bulk migration batch. IMPORTANT: Run preview_bulk_migration first to validate your data. Creates one migration job per valid row. Requires TREKMAIL_ALLOW_MIGRATION=true and confirm_start=true.",
      inputSchema: {
        data: z.string().describe("CSV data: source_email,source_password,destination_email per line"),
        provider: z.enum(["gmail", "outlook", "yahoo", "icloud", "generic_imap"]).optional().describe("Source email provider"),
        source_host: z.string().max(255).optional().describe("IMAP host"),
        source_port: z.number().int().positive().optional().describe("IMAP port"),
        source_security: z.enum(["ssl", "tls", "none"]).optional().describe("Connection security"),
        per_row_server: z.boolean().optional().describe("Each row has its own server settings"),
        folder_strategy: z.enum(["all", "standard", "inbox_only"]).optional().describe("Folder strategy"),
        import_since: z.string().optional().describe("Date filter (YYYY-MM-DD)"),
        skip_duplicates: z.boolean().optional().describe("Skip duplicates (default: true)"),
        name: z.string().max(100).optional().describe("Batch name"),
        confirm_start: z.boolean().describe("Must be true to start. Safety gate."),
        idempotency_key: z.string().optional().describe("Optional idempotency key"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ confirm_start, idempotency_key, ...params }) => {
      if (!config.allowMigration) {
        return errorResult("Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true.");
      }
      if (!confirm_start) {
        return errorResult("Not confirmed. Set confirm_start=true to start the bulk migration.");
      }
      const idemKey = idempotencyKey("start_bulk_migration", { data_len: params.data.length }, idempotency_key);
      return callApi(() => client.startBulkMigration(params, idemKey));
    },
  );

  // list_bulk_migrations - no safety gate
  server.registerTool(
    "list_bulk_migrations",
    {
      title: "List Bulk Migrations",
      description: "List bulk migration batches for your account. Supports filtering by status.",
      inputSchema: {
        status: z.enum(["queued", "processing", "paused", "completed", "completed_with_errors", "cancelled"]).optional().describe("Filter by batch status"),
        per_page: z.number().int().min(1).max(100).optional().describe("Results per page"),
      },
    },
    async ({ status, per_page }) => {
      return callApi(() => client.listBulkMigrations({ status, per_page }));
    },
  );

  // get_bulk_migration - no safety gate
  server.registerTool(
    "get_bulk_migration",
    {
      title: "Get Bulk Migration",
      description: "Get details of a bulk migration batch including per-job status breakdown.",
      inputSchema: {
        batch_id: z.number().int().positive().describe("The batch ID"),
      },
    },
    async ({ batch_id }) => {
      return callApi(() => client.getBulkMigration(batch_id));
    },
  );

  // cancel_bulk_migration - safety gate: confirm_cancel
  server.registerTool(
    "cancel_bulk_migration",
    {
      title: "Cancel Bulk Migration",
      description: "Cancel an active bulk migration batch. All queued and running jobs will be stopped. Set confirm_cancel=true to proceed.",
      inputSchema: {
        batch_id: z.number().int().positive().describe("The batch ID to cancel"),
        confirm_cancel: z.boolean().describe("Must be true to cancel. Safety gate."),
      },
      annotations: { destructiveHint: true },
    },
    async ({ batch_id, confirm_cancel }) => {
      if (!confirm_cancel) {
        return errorResult("Not confirmed. Set confirm_cancel=true to cancel the bulk migration.");
      }
      // Audit finding #19: server route /migrations/bulk/{batch}:cancel
      // is NOT registered with the api.idempotency middleware, so any
      // Idempotency-Key we send is silently ignored. Don't compute one
      // — it gives a false sense of dedup safety. (To make this real,
      // server route must add api.idempotency middleware.)
      return callApi(() => client.cancelBulkMigration(batch_id));
    },
  );

  // retry_bulk_migration - safety gate: allowMigration + confirm_retry
  server.registerTool(
    "retry_bulk_migration",
    {
      title: "Retry Bulk Migration",
      description: "Retry all failed jobs in a bulk migration batch. Requires TREKMAIL_ALLOW_MIGRATION=true and confirm_retry=true.",
      inputSchema: {
        batch_id: z.number().int().positive().describe("The batch ID"),
        confirm_retry: z.boolean().describe("Must be true to retry. Safety gate."),
      },
      annotations: { destructiveHint: true },
    },
    async ({ batch_id, confirm_retry }) => {
      if (!config.allowMigration) {
        return errorResult("Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true.");
      }
      if (!confirm_retry) {
        return errorResult("Not confirmed. Set confirm_retry=true to retry failed jobs.");
      }
      // Audit finding #19 — server route lacks api.idempotency.
      return callApi(() => client.retryBulkMigration(batch_id));
    },
  );

  // delete_bulk_migration - safety gate: allowMigration + confirm_delete
  server.registerTool(
    "delete_bulk_migration",
    {
      title: "Delete Bulk Migration Batch",
      description: "Delete a completed, failed, or cancelled bulk migration batch record. Cannot delete active batches. Both TREKMAIL_ALLOW_MIGRATION=true and confirm_delete=true are required.",
      inputSchema: {
        batch_id: z.number().int().positive().describe("The batch ID to delete"),
        confirm_delete: z.boolean().describe("Must be true to delete. Safety gate."),
      },
      annotations: { destructiveHint: true },
    },
    async ({ batch_id, confirm_delete }) => {
      if (!config.allowMigration) {
        return errorResult(
          "Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable.",
        );
      }
      if (!confirm_delete) {
        return errorResult("Deletion not confirmed. Set confirm_delete=true to delete the bulk migration batch.");
      }
      // Audit finding #19 — server route lacks api.idempotency. Also
      // DELETE is not handled by ApiIdempotency at all (audit #6).
      return callApi(() => client.deleteBulkMigration(batch_id));
    },
  );

  // update_bulk_migration_job_password - safety gate: allowMigration
  server.registerTool(
    "update_bulk_migration_job_password",
    {
      title: "Update Bulk Migration Job Password",
      description: "Update the source IMAP password for a failed job in a bulk migration batch. Only works on jobs with 'failed' status. Requires TREKMAIL_ALLOW_MIGRATION=true.",
      inputSchema: {
        batch_id: z.number().int().positive().describe("The batch ID"),
        job_id: z.number().int().positive().describe("The job ID within the batch"),
        source_password: z.string().max(255).describe("New source IMAP password or app password"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ batch_id, job_id, source_password }) => {
      if (!config.allowMigration) {
        return errorResult(
          "Migration operations are disabled. Set TREKMAIL_ALLOW_MIGRATION=true to enable.",
        );
      }
      return callApi(() => client.updateBulkMigrationJobPassword(batch_id, job_id, source_password));
    },
  );

  // resume_bulk_migration - no allowMigration gate (safety/resumption operation)
  server.registerTool(
    "resume_bulk_migration",
    {
      title: "Resume Bulk Migration",
      description: "Resume a paused bulk migration batch (e.g., paused due to storage limits). Set confirm_resume=true to proceed.",
      inputSchema: {
        batch_id: z.number().int().positive().describe("The batch ID to resume"),
        confirm_resume: z.boolean().describe("Must be true to resume. Safety gate."),
      },
      annotations: { destructiveHint: true },
    },
    async ({ batch_id, confirm_resume }) => {
      if (!confirm_resume) {
        return errorResult("Not confirmed. Set confirm_resume=true to resume the batch.");
      }
      // Audit finding #19 — server route lacks api.idempotency.
      return callApi(() => client.resumeBulkMigration(batch_id));
    },
  );
}
