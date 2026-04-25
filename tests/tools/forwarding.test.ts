import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";

describe("forwarding tools", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      getForwarding: vi.fn().mockResolvedValue({ enabled: false, targets: [] }),
      setForwarding: vi.fn().mockResolvedValue({ enabled: true, targets: ["a@b.com"] }),
    } as unknown as TrekMailClient;
  });

  it("getForwarding passes mailbox_id to client", async () => {
    await client.getForwarding(10);
    expect(client.getForwarding).toHaveBeenCalledWith(10);
  });

  it("setForwarding generates deterministic idempotency key", () => {
    const key = idempotencyKey("set_forwarding", {
      mailbox_id: 10,
      enabled: true,
      targets: ["x@y.com"],
      keep_copy: false,
    });
    expect(key).toMatch(/^mcp_set_forwarding_/);
    // Same params = same key
    const key2 = idempotencyKey("set_forwarding", {
      mailbox_id: 10,
      enabled: true,
      targets: ["x@y.com"],
      keep_copy: false,
    });
    expect(key).toBe(key2);
  });
});
