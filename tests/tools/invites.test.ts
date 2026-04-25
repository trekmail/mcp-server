import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";

describe("invite tools", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      createInvite: vi.fn().mockResolvedValue({ id: 1, status: "pending" }),
      createInvitesBulk: vi.fn().mockResolvedValue({ results: [] }),
    } as unknown as TrekMailClient;
  });

  it("createInvite passes params to client", async () => {
    await client.createInvite(
      { domain_id: 1, local_part: "bob", recipient_email: "bob@gmail.com" },
      "idem-key",
    );
    expect(client.createInvite).toHaveBeenCalledWith(
      { domain_id: 1, local_part: "bob", recipient_email: "bob@gmail.com" },
      "idem-key",
    );
  });

  it("createInvitesBulk generates deterministic idempotency key", () => {
    const items = [{ local_part: "a", recipient_email: "a@b.com" }];
    const key = idempotencyKey("create_invites_bulk", {
      domain_id: 1,
      items,
      expires_in_hours: 72,
    });
    expect(key).toMatch(/^mcp_create_invites_bulk_/);
  });
});
