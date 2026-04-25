import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRetry } from "../src/retry.js";
import { TrekMailApiError } from "../src/errors.js";

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns result on success without retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 2 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on HTTP 429", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TrekMailApiError(429, "rate_limited", "Too many requests"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10, jitterFraction: 0 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 503", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TrekMailApiError(503, "service_unavailable", "Unavailable"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10, jitterFraction: 0 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on HTTP 504", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TrekMailApiError(504, "gateway_timeout", "Timeout"))
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10, jitterFraction: 0 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on network TypeError with ECONNRESET", async () => {
    const networkError = new TypeError("fetch failed");
    Object.defineProperty(networkError, "cause", { value: { code: "ECONNRESET" } });

    const fn = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10, jitterFraction: 0 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on network TypeError with ETIMEDOUT", async () => {
    const networkError = new TypeError("fetch failed");
    Object.defineProperty(networkError, "cause", { value: { code: "ETIMEDOUT" } });

    const fn = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValue("ok");

    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10, jitterFraction: 0 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on HTTP 400", async () => {
    const fn = vi.fn()
      .mockRejectedValue(new TrekMailApiError(400, "bad_request", "Bad"));

    await expect(
      withRetry(fn, { maxRetries: 2 }),
    ).rejects.toThrow("Bad");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on HTTP 401", async () => {
    const fn = vi.fn()
      .mockRejectedValue(new TrekMailApiError(401, "unauthorized", "Unauthorized"));

    await expect(
      withRetry(fn, { maxRetries: 2 }),
    ).rejects.toThrow("Unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on HTTP 422", async () => {
    const fn = vi.fn()
      .mockRejectedValue(new TrekMailApiError(422, "validation_error", "Invalid"));

    await expect(
      withRetry(fn, { maxRetries: 2 }),
    ).rejects.toThrow("Invalid");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops after maxRetries exhausted", async () => {
    vi.useRealTimers();

    const fn = vi.fn()
      .mockRejectedValue(new TrekMailApiError(429, "rate_limited", "Too many"));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1, jitterFraction: 0 }),
    ).rejects.toThrow("Too many");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });
});
