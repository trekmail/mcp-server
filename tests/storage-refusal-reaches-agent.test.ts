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
    // Ticket #547: the client's mailbox maximum and mailbox size.
    [422, "client_mailbox_limit_reached", "create_delete_intent"],
    [422, "client_mailbox_size_exceeded", "at most max_mailbox_size_mb from Details"],
    [422, "client_mailbox_size_required", "set_client_limit with mailbox_size_mb=null"],
    [422, "client_mailbox_size_above_limit", "In the same set_client_limit call"],
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
      "client_mailbox_limit_reached",
      "client_mailbox_size_exceeded",
      "client_mailbox_size_required",
      "client_mailbox_size_above_limit",
    ]) {
      const action = actionOf(refusal(422, code)).join(" ");
      expect(action, code).not.toMatch(/upgrade/i);
      // Words that tell a White Label client who really runs their mail.
      expect(action, code).not.toMatch(/reseller|white label/i);
    }
  });

  /**
   * Ticket #547: the refusals a client's own agent meets (the mailbox maximum,
   * the mailbox size) point it at the administrator the way the storage limit
   * does; and where the client has a mailbox size there is no shared storage,
   * so the older lines offer it only where the client has none.
   */
  it("mailbox cap refusals send a client to the administrator, and shared storage is offered only without a mailbox size", () => {
    for (const code of ["client_mailbox_limit_reached", "client_mailbox_size_exceeded", "client_mailbox_size_required"]) {
      const action = actionOf(refusal(422, code))[0];
      expect(action, code).toContain("set_client_limit");
      expect(action, code).toContain("asks the account administrator");
    }

    expect(actionOf(refusal(422, "client_storage_limit_exceeded"))[0]).toContain("or shared storage where the client has no mailbox size");
    expect(actionOf(refusal(422, "client_storage_below_usage"))[0]).toContain("where the client has no mailbox size, move the mailbox to shared storage");
    expect(actionOf(refusal(422, "storage_pool_exceeded"))[0]).toContain("where the client has no mailbox size, shared storage");
    // Leaving the size out is the fix only where a size can be left out.
    expect(actionOf(refusal(422, "client_mailbox_size_exceeded"))[0]).toContain("when creating or inviting, leaving the size out");
    // No tool lists or cancels an invitation: the agent is not sent to do it.
    const full = actionOf(refusal(422, "client_mailbox_limit_reached"))[0];
    expect(full).not.toContain("or cancel a pending invitation");
    expect(full).toContain("a person cancels it in the dashboard; no tool cancels one");
  });

  it("a bulk batch refused row by row for the client's mailbox maximum names the next step", () => {
    const text = TrekMailApiError.fromResponse(207, {
      counts: { created: 1, failed: 1 },
      results: [
        { email: "a@client.test", status: "created" },
        { email: "b@client.test", status: "failed", reason: "client_mailbox_limit_reached", error: "No mailboxes left." },
      ],
    }).toMcpText();

    expect(text).toContain("API Error [client_mailbox_limit_reached]");
    expect(actionOf(text)).toHaveLength(1);
    expect(actionOf(text)[0]).toContain("max_mailboxes");
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
