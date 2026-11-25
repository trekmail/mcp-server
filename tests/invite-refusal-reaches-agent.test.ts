import { describe, expect, it } from "vitest";

import { TrekMailApiError } from "../src/errors.js";

/**
 * An invitation refusal names the invite tool that moves things on (ticket
 * #581), so an agent resends or cancels instead of retrying the same call.
 */
describe("invitation refusals reach the agent with an action", () => {
  const text = (status: number, code: string) =>
    TrekMailApiError.fromResponse(status, {
      error: { code, message: "Refused.", hint: "REST hint.", request_id: "req-1", retryable: false },
    }).toMcpText();
  const actionOf = (value: string) => value.split("\n").filter((line) => line.startsWith("Action: "));

  it.each([
    [409, "localpart_pending", "list_invites, then resend_invite emails it again, or cancel_invite frees the name"],
    [409, "localpart_exists", "the mailbox already exists"],
    [409, "invite_already_used", "list_mailboxes"],
    [409, "invite_canceled", "create_invite"],
    [409, "invite_expired", "resend_invite revives this invitation"],
    [422, "mailbox_limit_reached", "list_invites, then cancel_invite"],
  ])("%i %s", (status, code, action) => {
    const value = text(status, code);
    expect(value).toContain(`API Error [${code}]: Refused.`);
    expect(value).toContain("Hint: REST hint.");
    expect(actionOf(value)).toHaveLength(1);
    expect(actionOf(value)[0]).toContain(action);
  });

  it("leaves other codes without an invitation action", () => {
    expect(actionOf(text(404, "not_found"))).toEqual([]);
  });
});
