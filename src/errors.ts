/**
 * Error thrown when the TrekMail API returns a structured error response.
 * Matches the API error envelope: { error: { code, message, hint, request_id, retryable } }
 */
export class TrekMailApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly hint?: string;
  public readonly requestId?: string;
  public readonly retryable: boolean | undefined;
  public readonly extra: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    opts: {
      hint?: string;
      requestId?: string;
      retryable?: boolean;
      extra?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "TrekMailApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.hint = opts.hint;
    this.requestId = opts.requestId;
    this.retryable = opts.retryable;
    this.extra = opts.extra ?? {};
  }

  static fromResponse(
    statusCode: number,
    body: Record<string, unknown>,
  ): TrekMailApiError {
    // A bulk endpoint that refuses every row answers 422 with `counts` and
    // `results` and NO `error` envelope — each row carries its own reason. Read
    // by the generic path below, that produced "unknown_error / An unknown
    // error occurred" with the real answer buried in Details, so an agent was
    // told nothing it could act on while the API had said exactly why
    // (ticket #382).
    const rowFailure = TrekMailApiError.fromRowResults(statusCode, body);
    if (rowFailure) return rowFailure;

    const error = (body.error ?? body) as Record<string, unknown>;
    const { code, message, hint, request_id, retryable, ...rest } = error;

    // Anything the envelope carries ALONGSIDE `error` belongs to the agent too.
    // A 402 puts the whole machine-payment challenge there — amount, currency,
    // network id, expiry — as a sibling of `error`, not inside it. Reading only
    // `body.error` dropped it, so an agent was told "present a payment token"
    // and never told for how much: the two-call protocol these tools document
    // cannot be completed without it.
    const siblings = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== "error"),
    );
    const extra = { ...rest, ...siblings };

    return new TrekMailApiError(
      statusCode,
      String(code ?? "unknown_error"),
      String(message ?? "An unknown error occurred"),
      {
        hint: hint ? String(hint) : undefined,
        requestId: request_id ? String(request_id) : undefined,
        retryable: typeof retryable === "boolean" ? retryable : undefined,
        extra,
      },
    );
  }

  /**
   * Build the error from per-row results when the envelope has none.
   *
   * Every failed row states a machine `reason` and a human `error`. One shared
   * reason becomes the code, so an agent can branch on it exactly as it would
   * on any other refusal; a mixed batch says so and keeps the rows (they are
   * carried into `extra` by the caller either way).
   */
  private static fromRowResults(
    statusCode: number,
    body: Record<string, unknown>,
  ): TrekMailApiError | null {
    if (body.error !== undefined || !Array.isArray(body.results)) return null;

    // Two words are in use for a failed row: bulk invites and DNS rechecks say
    // "failed", bulk domain-add says "error". Matching only "failed" meant an
    // all-duplicate domains:bulk-add — every row carrying a perfectly good
    // reason and message — fell through to the generic branch and reached the
    // agent as "unknown_error / An unknown error occurred", the exact failure
    // this method exists to prevent. Accept both.
    const failed = (body.results as Array<Record<string, unknown>>).filter(
      (row) =>
        row &&
        typeof row === "object" &&
        (row.status === "failed" || row.status === "error"),
    );
    if (failed.length === 0) return null;

    const reasons = [
      ...new Set(
        failed
          .map((row) => (typeof row.reason === "string" ? row.reason : null))
          .filter((reason): reason is string => Boolean(reason)),
      ),
    ];
    const messages = [
      ...new Set(
        failed
          .map((row) => (typeof row.error === "string" ? row.error : null))
          .filter((message): message is string => Boolean(message)),
      ),
    ];

    const total = (body.results as unknown[]).length;
    const code = reasons.length === 1 ? reasons[0] : "bulk_all_failed";
    const message =
      messages.length === 1
        ? messages[0]
        : `${failed.length} of ${total} rows failed: ${messages.join(" ")}`;

    return new TrekMailApiError(statusCode, code, message, {
      extra: Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== "error"),
      ),
    });
  }

  toMcpText(): string {
    let text = `API Error [${this.code}]: ${this.message}`;
    if (this.hint) text += `\nHint: ${this.hint}`;
    if (this.requestId) text += `\nRequest ID: ${this.requestId}`;

    const planGatedCodes = [
      "plan_api_disabled",
      "token_scope_blocked_by_plan",
      "feature_not_available",
      "plan_limit_reached",
    ];
    if (planGatedCodes.includes(this.code)) {
      text +=
        "\nAction: Check your TrekMail plan. API access requires a Pro or Agency subscription.";
    }

    // A sending allowance is used up. Retrying before it renews cannot work,
    // and the API deliberately sends no retry_after: say when instead.
    const dimension = this.extra["dimension"];
    if (typeof dimension === "string" && dimension !== "") {
      const resetsAt = this.extra["resets_at"];
      text +=
        dimension === "recipients_per_message"
          ? "\nAction: Do not retry as is. Split the message so each part has fewer recipients (To + Cc + Bcc)."
          : `\nAction: Do not retry before ${typeof resetsAt === "string" ? resetsAt : "the allowance renews"}. get_mailbox_sending_limits (message token) or get_sending_limits (account token) shows the allowance and when it renews.`;
    }

    const sharedMailboxAction = SHARED_MAILBOX_ACTIONS[this.code];
    if (sharedMailboxAction) text += `\nAction: ${sharedMailboxAction}`;
    const details = this.extra["details"];
    if (
      this.code === "validation_error" &&
      details !== null &&
      typeof details === "object" &&
      "shared_mailbox_id" in details
    ) {
      text +=
        "\nAction: Call save_draft or update_draft again without shared_mailbox_id, or send directly with send_message and shared_mailbox_id.";
    }

    if (Object.keys(this.extra).length > 0) {
      text += `\nDetails: ${JSON.stringify(this.extra)}`;
    }
    return text;
  }
}

/**
 * Shared mailbox refusals name the MCP tool that fixes each one, so an agent
 * acts on it instead of retrying or switching to another From address. The
 * API hint names the REST call; Details carries the ids for the next call.
 */
const SHARED_MAILBOX_ACTIONS: Readonly<Record<string, string>> = {
  no_access_left:
    "Keep can_read or can_send true. To take away all access, call remove_shared_mailbox_member.",
  send_only_disabled:
    "Do not retry. Keep can_read true, or set can_send false for read-only access; send-only access is not turned on for this service yet.",
  last_reader:
    "Give another member Read first (update_shared_mailbox_member with can_read=true, or add_shared_mailbox_member), then repeat this call.",
  already_member:
    "Call update_shared_mailbox_member with the member_id from Details instead of adding the member again.",
  shared_mailbox_send_denied:
    "Do not retry with another From address or identity. Tell the user that an administrator can grant Read and Send as (update_shared_mailbox_member), or that they can send from webmail or a mail app.",
  identity_unavailable:
    "Call list_identities and use an id from it, or leave identity_id out. Team addresses from send-only access cannot be used through MCP.",
  identity_delegated:
    "Leave this identity unchanged. Its access follows the shared mailbox (update_shared_mailbox_member or remove_shared_mailbox_member); its signature is edited in webmail.",
};

/**
 * Error thrown for client-side issues (network, timeout, config).
 */
export class TrekMailClientError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TrekMailClientError";
  }
}
