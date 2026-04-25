import { TrekMailApiError } from "./errors.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  jitterFraction?: number;
  /** If false, only retry on connection errors (not timeouts). Prevents double-execution of non-idempotent mutations. */
  idempotent?: boolean;
}

const RETRYABLE_STATUS_CODES = new Set([429, 503, 504]);

const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function isRetryableError(error: unknown): boolean {
  if (error instanceof TrekMailApiError) {
    // Respect API's retryable field — if explicitly false, don't retry even on 429
    if (error.retryable === false) {
      return false;
    }
    return RETRYABLE_STATUS_CODES.has(error.statusCode);
  }

  // Network errors from Node fetch: TypeError wrapping system errors
  if (error instanceof TypeError) {
    const cause = (error as { cause?: { code?: string } }).cause;
    if (cause?.code && RETRYABLE_ERROR_CODES.has(cause.code)) {
      return true;
    }
    // Generic fetch failure (DNS, connection refused, etc.)
    if (error.message.includes("fetch failed")) {
      return true;
    }
  }

  // AbortError from timeout — only safe to retry if the request is idempotent.
  // For non-idempotent mutations, the server may have already processed the request.
  // Callers must opt-in by setting `idempotent: true` in RetryOptions.
  if (error instanceof DOMException && error.name === "AbortError") {
    return false; // Default: don't retry timeouts. Overridden per-call via idempotent flag.
  }

  return false;
}

function getRetryAfterMs(error: unknown): number | null {
  if (error instanceof TrekMailApiError && error.statusCode === 429) {
    const retryAfter = error.extra["retry_after"];
    if (typeof retryAfter === "number" && retryAfter > 0) {
      return retryAfter * 1000;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const jitterFraction = opts.jitterFraction ?? 0.25;
  const idempotent = opts.idempotent ?? false;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // For idempotent requests, also retry AbortError (timeout)
      const isTimeout =
        error instanceof DOMException && error.name === "AbortError";
      const canRetry = isRetryableError(error) || (idempotent && isTimeout);

      if (attempt >= maxRetries || !canRetry) {
        throw error;
      }

      const retryAfterMs = getRetryAfterMs(error);
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const baseDelay = retryAfterMs ?? exponentialDelay;
      const jitter = baseDelay * jitterFraction * Math.random();
      const delayMs = baseDelay + jitter;

      await sleep(delayMs);
    }
  }

  throw lastError;
}
