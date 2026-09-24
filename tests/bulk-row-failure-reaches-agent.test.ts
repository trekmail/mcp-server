import { describe, expect, it } from "vitest";

import { TrekMailApiError } from "../src/errors.js";

/**
 * A bulk endpoint that refuses every row answers 422 with `counts` + `results`
 * and no `error` envelope. The generic mapper read that as
 * "unknown_error / An unknown error occurred" and buried the real answer, so an
 * agent had nothing to act on while the API had said exactly why (ticket #382).
 */
describe("bulk results without an error envelope", () => {
  const body = (rows: Array<Record<string, unknown>>) => ({
    counts: { created: 0, failed: rows.length },
    results: rows,
  });

  it("speaks the row's reason when every row failed for the same one", () => {
    const err = TrekMailApiError.fromResponse(
      422,
      body([
        {
          email: "info@send.example",
          status: "failed",
          reason: "domain_hosts_no_mailboxes",
          error:
            "This domain keeps its incoming mail with another provider and cannot hold mailboxes.",
        },
      ]),
    );

    expect(err.code).toBe("domain_hosts_no_mailboxes");
    expect(err.message).toContain("cannot hold mailboxes");
    expect(err.toMcpText()).not.toContain("unknown error");
    // The rows stay available for a caller that wants the detail.
    expect(err.extra.results).toHaveLength(1);
  });

  it("names a mixed batch instead of picking one reason", () => {
    const err = TrekMailApiError.fromResponse(
      422,
      body([
        {
          email: "a@send.example",
          status: "failed",
          reason: "domain_hosts_no_mailboxes",
          error: "This domain cannot hold mailboxes.",
        },
        {
          email: "b@hosted.example",
          status: "failed",
          reason: "already_exists",
          error: "This mailbox already exists.",
        },
      ]),
    );

    expect(err.code).toBe("bulk_all_failed");
    expect(err.message).toContain("2 of 2 rows failed");
    expect(err.message).toContain("already exists");
  });

  it("reads rows that say 'error' as well as rows that say 'failed'", () => {
    // domains:bulk-add marks a refused row status:"error"; bulk invites and DNS
    // rechecks say "failed". Matching only "failed" sent an all-duplicate
    // bulk-add back to the generic branch, so every row carried a usable reason
    // and the agent still got "unknown_error".
    const err = TrekMailApiError.fromResponse(422, {
      created: 0,
      total: 2,
      results: [
        {
          domain: "taken-one.example",
          status: "error",
          reason: "domain_already_connected",
          error: "That domain is already connected to a TrekMail account.",
        },
        {
          domain: "taken-two.example",
          status: "error",
          reason: "domain_already_connected",
          error: "That domain is already connected to a TrekMail account.",
        },
      ],
    });

    expect(err.code).toBe("domain_already_connected");
    expect(err.message).toContain("already connected");
    expect(err.toMcpText()).not.toContain("unknown error");
    expect(err.extra.results).toHaveLength(2);
  });

  it("still reads an ordinary error envelope", () => {
    const err = TrekMailApiError.fromResponse(422, {
      error: { code: "validation_error", message: "The given data was invalid." },
    });

    expect(err.code).toBe("validation_error");
    expect(err.message).toBe("The given data was invalid.");
  });

  it("leaves a partial success alone — those rows are not the whole answer", () => {
    const err = TrekMailApiError.fromResponse(500, {
      counts: { created: 1, failed: 0 },
      results: [{ email: "ok@hosted.example", status: "created", mailbox_id: 7 }],
    });

    expect(err.code).toBe("unknown_error");
  });
});
