import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";
import { idempotencyKey } from "../../src/idempotency.js";

describe("dns tools", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      getDnsRequirements: vi.fn().mockResolvedValue({ records: [] }),
      dnsRecheck: vi.fn().mockResolvedValue({ id: 1, status: "pending" }),
      getDnsCheck: vi.fn().mockResolvedValue({ id: 1, status: "complete" }),
    } as unknown as TrekMailClient;
  });

  it("getDnsRequirements passes domain_id to client", async () => {
    await client.getDnsRequirements(5);
    expect(client.getDnsRequirements).toHaveBeenCalledWith(5);
  });

  it("dnsRecheck generates deterministic idempotency key", () => {
    const key = idempotencyKey("dns_recheck", { domain_id: 5 });
    expect(key).toMatch(/^mcp_dns_recheck_/);
    // Same call = same key
    expect(idempotencyKey("dns_recheck", { domain_id: 5 })).toBe(key);
  });

  it("getDnsCheck passes check_id to client", async () => {
    await client.getDnsCheck(99);
    expect(client.getDnsCheck).toHaveBeenCalledWith(99);
  });
});
