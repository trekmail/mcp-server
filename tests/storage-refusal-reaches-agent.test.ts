import { describe, expect, it } from "vitest";

import { TrekMailApiError } from "../src/errors.js";

/**
 * A storage refusal must say which call frees room, so an agent does not retry
 * the same size (ticket #482). The same codes come from create, invite,
 * restore, set_mailbox_storage and, per row, the bulk tools.
 */
describe("storage refusals reach the agent with an action", () => {
  const refusal = (status: number, code: string, details: Record<string, unknown> = {}) =>
    TrekMailApiError.fromResponse(status, {
      error: {
        code,
        message: "Refused.",
        hint: "REST hint.",
        request_id: "req-1",
        retryable: false,
        details,
      },
    }).toMcpText();

  const actionOf = (text: string) => text.split("\n").filter((line) => line.startsWith("Action: "));

  it.each([
    [422, "storage_pool_exceeded", "set_mailbox_storage"],
    [422, "client_storage_limit_exceeded", "Choose at most available_mb from Details"],
    [422, "client_storage_below_usage", "set_mailbox_storage with storage_allocation_mb=null"],
    [422, "client_storage_limit_too_low", "at least minimum_mb from Details"],
    [409, "client_storage_domains_conflict", "remove_client_limit"],
    [403, "shared_folder_client_storage_limit", "without is_shared"],
  ])("%i %s names the next step", (status, code, action) => {
    const text = refusal(status, code, { limit_mb: 1000, available_mb: 200, used_mb: 700, minimum_mb: 900 });

    expect(text).toContain(`API Error [${code}]`);
    expect(text).toContain("Hint: REST hint.");
    expect(actionOf(text)).toHaveLength(1);
    expect(actionOf(text)[0]).toContain(action);
    // The numbers the action points at travel with it.
    expect(text).toContain('"available_mb":200');
  });

  it("raising a client limit is set_client_limit or the administrator, never a plan upgrade", () => {
    const text = refusal(422, "client_storage_limit_exceeded");

    expect(actionOf(text)[0]).toContain("set_client_limit");
    // Plan D18: a client's agent relays this line to the client, who is told to
    // ask the administrator, as the dashboard and the API's hint tell them.
    expect(actionOf(text)[0]).toContain("asks the account administrator");
    for (const code of [
      "storage_pool_exceeded",
      "client_storage_limit_exceeded",
      "client_storage_below_usage",
      "client_storage_limit_too_low",
      "client_storage_domains_conflict",
      "shared_folder_client_storage_limit",
    ]) {
      const action = actionOf(refusal(422, code)).join(" ");
      expect(action, code).not.toMatch(/upgrade/i);
      // Words that tell a White Label client who really runs their mail.
      expect(action, code).not.toMatch(/reseller|white label/i);
    }
  });

  it("a bulk batch refused row by row for the client limit gets the same action", () => {
    const text = TrekMailApiError.fromResponse(422, {
      counts: { created: 0, failed: 2 },
      results: [
        { email: "a@client.test", status: "failed", reason: "client_storage_limit_exceeded", error: "Over the client's limit." },
        { email: "b@client.test", status: "failed", reason: "client_storage_limit_exceeded", error: "Over the client's limit." },
      ],
    }).toMcpText();

    expect(text).toContain("API Error [client_storage_limit_exceeded]");
    expect(actionOf(text)).toHaveLength(1);
    expect(actionOf(text)[0]).toContain("set_mailbox_storage");
  });

  it("an unrelated refusal gets no storage action", () => {
    expect(actionOf(refusal(422, "mailbox_limit_reached"))).toEqual([]);
    expect(actionOf(refusal(422, "validation_error"))).toEqual([]);
  });
});
