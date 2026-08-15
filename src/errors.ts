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

    if (Object.keys(this.extra).length > 0) {
      text += `\nDetails: ${JSON.stringify(this.extra)}`;
    }
    return text;
  }
}

/**
 * Error thrown for client-side issues (network, timeout, config).
 */
export class TrekMailClientError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TrekMailClientError";
  }
}
