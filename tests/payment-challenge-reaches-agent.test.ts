import { describe, it, expect } from "vitest";
import { TrekMailApiError } from "../src/errors.js";

describe("a 402 challenge survives the trip to the agent", () => {
  // Shape taken verbatim from a live prod response.
  const body = {
    error: {
      code: "payment_required",
      message: "Present a shared payment token to complete this purchase.",
      retryable: true,
    },
    payment: {
      protocol: "MPP",
      amount_minor: 500,
      currency: "usd",
      network_id: "profile_61TYmoIwRY90vKUSMA6TYmoIPLSQiy075jUQSWKlUKno",
      credential_header: "Payment-Authorization",
      expires_at: 1786725373,
    },
  };

  it("keeps the amount the agent has to authorise", () => {
    const err = TrekMailApiError.fromResponse(402, body);

    expect(err.code).toBe("payment_required");
    expect(err.extra.payment).toEqual(body.payment);
  });

  it("puts the amount in the text the agent actually reads", () => {
    const text = TrekMailApiError.fromResponse(402, body).toMcpText();

    // Without these an agent knows payment is due and nothing else: it cannot
    // mint a token for an amount it was never told.
    expect(text).toContain("500");
    expect(text).toContain("usd");
    expect(text).toContain("profile_61TYmoIw");
  });

  it("still reads a plain error envelope with no siblings", () => {
    const err = TrekMailApiError.fromResponse(403, {
      error: { code: "insufficient_scope", message: "Token is missing required scope" },
    });

    expect(err.code).toBe("insufficient_scope");
    expect(err.extra).toEqual({});
  });
});
