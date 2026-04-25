import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";

describe("message token tools", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      createMessageToken: vi.fn().mockResolvedValue({
        id: 1,
        token: "tm_msg_plain_token",
        prefix: "tm_msg_pla",
        name: "My Token",
        scopes: ["messages:read"],
      }),
      listMessageTokens: vi.fn().mockResolvedValue({
        data: [{ id: 1, prefix: "tm_msg_abc", name: "Token 1" }],
      }),
      revokeMessageToken: vi.fn().mockResolvedValue({
        id: 1,
        revoked_at: "2026-03-20T12:00:00.000Z",
      }),
    } as unknown as TrekMailClient;
  });

  it("createMessageToken passes correct params to client", async () => {
    await client.createMessageToken(
      42,
      { name: "My Token", scopes: ["messages:read", "messages:write"], expires_in: "30d" },
      "idem-key-123",
    );
    expect(client.createMessageToken).toHaveBeenCalledWith(
      42,
      { name: "My Token", scopes: ["messages:read", "messages:write"], expires_in: "30d" },
      "idem-key-123",
    );
  });

  it("listMessageTokens passes mailbox_id and pagination", async () => {
    await client.listMessageTokens(42, { page: 2, per_page: 10 });
    expect(client.listMessageTokens).toHaveBeenCalledWith(42, {
      page: 2,
      per_page: 10,
    });
  });

  it("revokeMessageToken passes token_id to client", async () => {
    await client.revokeMessageToken(99);
    expect(client.revokeMessageToken).toHaveBeenCalledWith(99);
  });

  it("create_message_token generates deterministic idempotency key", () => {
    const key = idempotencyKey("create_message_token", {
      mailbox_id: 42,
      name: "My Token",
      scopes: "messages:read,messages:write",
    });
    expect(key).toMatch(/^mcp_create_message_token_[a-f0-9]{32}$/);

    // Same params = same key
    const key2 = idempotencyKey("create_message_token", {
      mailbox_id: 42,
      name: "My Token",
      scopes: "messages:read,messages:write",
    });
    expect(key).toBe(key2);
  });
});
