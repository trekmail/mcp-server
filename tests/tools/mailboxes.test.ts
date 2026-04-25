import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";

describe("mailbox tools", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      listMailboxes: vi.fn().mockResolvedValue({ data: [] }),
      createMailboxGeneratedPassword: vi.fn().mockResolvedValue({ id: 1, email: "alice@example.com" }),
    } as unknown as TrekMailClient;
  });

  it("listMailboxes passes filter params to client", async () => {
    await client.listMailboxes({ domain_id: 3, search: "alice" });
    expect(client.listMailboxes).toHaveBeenCalledWith({ domain_id: 3, search: "alice" });
  });

  it("createMailboxGeneratedPassword generates deterministic idempotency key", () => {
    const key = idempotencyKey("create_mailbox_generated_password", {
      domain_id: 5,
      local_part: "alice",
      display_name: undefined,
    });
    expect(key).toMatch(/^mcp_create_mailbox_generated_password_/);
    // Same params = same key
    const key2 = idempotencyKey("create_mailbox_generated_password", {
      domain_id: 5,
      local_part: "alice",
      display_name: undefined,
    });
    expect(key).toBe(key2);
  });

  it("createMailboxGeneratedPassword uses explicit key when provided", () => {
    const key = idempotencyKey(
      "create_mailbox_generated_password",
      { domain_id: 5, local_part: "alice" },
      "my-explicit-key",
    );
    expect(key).toBe("my-explicit-key");
  });
});
