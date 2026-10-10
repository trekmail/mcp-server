import { describe, expect, it } from "vitest";

import { TrekMailApiError } from "../src/errors.js";

/**
 * A shared mailbox refusal must tell an agent what to do next with the MCP
 * tool that does it, and carry the ids for that call. Without an Action line
 * an agent retries, or worse, sends from another address (ticket #476).
 */
describe("shared mailbox refusals reach the agent with an action", () => {
  const refusal = (status: number, code: string, extra: Record<string, unknown> = {}) =>
    TrekMailApiError.fromResponse(status, {
      error: {
        code,
        message: "Refused.",
        hint: "REST hint.",
        request_id: "req-1",
        retryable: false,
        ...extra,
      },
    }).toMcpText();

  it.each([
    [422, "no_access_left", "remove_shared_mailbox_member"],
    [422, "send_only_disabled", "Do not retry"],
    [422, "last_reader", "update_shared_mailbox_member with can_read=true"],
    [409, "already_member", "update_shared_mailbox_member"],
    [403, "shared_mailbox_send_denied", "Do not retry with another From address"],
    [422, "identity_unavailable", "list_identities"],
    [422, "identity_delegated", "Leave this identity unchanged"],
  ])("%i %s names the next step", (status, code, action) => {
    const text = refusal(status, code, { shared_mailbox_id: 9, member_id: 6 });

    expect(text).toContain(`API Error [${code}]`);
    expect(text).toContain("Hint: REST hint.");
    expect(text).toMatch(new RegExp(`\\nAction: .*${action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    expect(text).toContain('"member_id":6');
  });

  it("a draft refused for its shared context says how to save or send instead", () => {
    const text = refusal(422, "validation_error", {
      details: { shared_mailbox_id: ["Drafts cannot be saved as a shared mailbox through the Message API."] },
    });

    expect(text).toContain("Action: Call save_draft or update_draft again without shared_mailbox_id");
  });

  it("an unrelated validation error gets no shared mailbox action", () => {
    const text = refusal(422, "validation_error", { details: { to: ["The to field is required."] } });

    expect(text).not.toContain("shared_mailbox_id");
    expect(text).not.toContain("Action:");
  });
});
