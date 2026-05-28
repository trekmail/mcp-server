import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrekMailClient } from "../client.js";
import { callApi, errorResult } from "./util.js";

export function registerVerifierTools(
  server: McpServer,
  client: TrekMailClient,
  config?: { allowDestructive?: boolean },
): void {
  server.registerTool(
    "verify_email",
    {
      title: "Verify Email Address",
      description:
        "Verify a single email address against 18 checks (syntax, MX, disposable, blocklist, SPF, DMARC, gibberish detection, typo suggestion, plus-addressing, DNSBL, domain age, Gravatar, unroutable MX, etc). Returns trust score 0-100 and status (safe/valid/risky/invalid). Quick mode: 1 credit. Deep mode: 2 credits (includes SMTP mailbox verification when available).",
      inputSchema: {
        email: z
          .string()
          .email()
          .describe("The email address to verify"),
        mode: z
          .enum(["quick", "deep"])
          .optional()
          .describe("Verification mode: quick (1 credit, default) or deep (2 credits, SMTP mailbox check)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ email, mode }) => {
      if (!config?.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to verify emails (consumes credits from the account balance).");
      }
      return callApi(() => client.verifySingleEmail(email, mode));
    },
  );

  server.registerTool(
    "verify_email_bulk",
    {
      title: "Verify Email List",
      description:
        "Submit a list of email addresses for bulk verification. Returns a job ID to track progress. Quick mode: 1 credit/email. Deep mode: 2 credits/email. Max 50,000 emails per job.",
      inputSchema: {
        emails: z
          .array(z.string().email())
          .min(1)
          .max(50000)
          .describe("Array of email addresses to verify"),
        name: z
          .string()
          .max(255)
          .optional()
          .describe("Optional name for this verification job"),
        mode: z
          .enum(["quick", "deep"])
          .optional()
          .describe("Verification mode: quick (1 credit, default) or deep (2 credits, SMTP mailbox check)"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ emails, name, mode }) => {
      if (!config?.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to bulk-verify emails (consumes credits from the account balance — up to 50,000/job).");
      }
      return callApi(() => client.verifyBulkEmails(emails, name, mode));
    },
  );

  server.registerTool(
    "verify_job_status",
    {
      title: "Check Verification Job Status",
      description:
        "Check the progress and results of a bulk email verification job. Returns status, progress percentage, summary counts, and paginated results when complete.",
      inputSchema: {
        job_id: z
          .number()
          .int()
          .positive()
          .describe("The verification job ID returned by verify_email_bulk"),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number for results (default 1)"),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Results per page (default 100, max 500)"),
        status: z
          .enum(["safe", "valid", "risky", "invalid"])
          .optional()
          .describe("Filter results by status"),
        search: z
          .string()
          .max(320)
          .optional()
          .describe("Search results by email address (partial match)"),
      },
    },
    async ({ job_id, page, per_page, status, search }) => {
      return callApi(() =>
        client.getVerifyJobStatus(job_id, { page, per_page, status, search }),
      );
    },
  );

  server.registerTool(
    "verify_credits",
    {
      title: "Check Verification Credit Balance",
      description:
        "Check the current email verification credit balance — monthly remaining, purchased, and total available.",
      inputSchema: {},
    },
    async () => {
      return callApi(() => client.getVerifyCredits());
    },
  );

  server.registerTool(
    "verify_list_jobs",
    {
      title: "List Verification Jobs",
      description:
        "List all email verification jobs for this account with pagination. Optionally filter by status.",
      inputSchema: {
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Page number (default 1)"),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Jobs per page (default 20, max 100)"),
        status: z
          .enum(["pending", "processing", "completed", "partial", "failed", "cancelled"])
          .optional()
          .describe("Filter by job status"),
      },
    },
    async ({ page, per_page, status }) => {
      return callApi(() =>
        client.getVerifyJobs({ page, per_page, status }),
      );
    },
  );

  server.registerTool(
    "verify_cancel_job",
    {
      title: "Cancel Verification Job",
      description:
        "Cancel a running verification job. Unprocessed credits are automatically refunded.",
      inputSchema: {
        job_id: z
          .number()
          .int()
          .positive()
          .describe("The verification job ID to cancel"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ job_id }) => {
      if (!config?.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to cancel verification jobs (unprocessed credits are refunded).");
      }
      return callApi(() => client.cancelVerifyJob(job_id));
    },
  );

  server.registerTool(
    "verify_delete_job",
    {
      title: "Delete Verification Job",
      description:
        "Permanently delete a verification job and all its results. Cannot be undone. Job must be completed or cancelled first.",
      inputSchema: {
        job_id: z
          .number()
          .int()
          .positive()
          .describe("The verification job ID to delete"),
      },
      annotations: { destructiveHint: true },
    },
    async ({ job_id }) => {
      if (!config?.allowDestructive) {
        return errorResult("Destructive operations are disabled. Set TREKMAIL_ALLOW_DESTRUCTIVE=true to delete verification jobs (permanent, results are wiped).");
      }
      return callApi(() => client.deleteVerifyJob(job_id));
    },
  );

  server.registerTool(
    "verify_job_download",
    {
      title: "Download Verification Results",
      description:
        "Returns the verification results as raw CSV body in the response (NOT a URL). Filters: all, safe, safe_risky. For very large jobs (>10MB) the response can be slow — consider filtering down to safe-only first.",
      inputSchema: {
        job_id: z
          .number()
          .int()
          .positive()
          .describe("The verification job ID"),
        filter: z
          .enum(["all", "safe", "safe_risky"])
          .optional()
          .describe("Filter results: all (default), safe, or safe_risky"),
      },
    },
    async ({ job_id, filter }) => {
      return callApi(() =>
        client.getVerifyJobDownload(job_id, filter),
      );
    },
  );
}
