import { describe, it, expect } from "vitest";
import { idempotencyKey } from "../src/idempotency.js";

describe("idempotencyKey", () => {
  it("generates deterministic keys for same tool + params", () => {
    const key1 = idempotencyKey("create_mailbox", { domain_id: 5, local_part: "alice" });
    const key2 = idempotencyKey("create_mailbox", { domain_id: 5, local_part: "alice" });
    expect(key1).toBe(key2);
  });

  it("generates different keys for different params", () => {
    const key1 = idempotencyKey("create_mailbox", { domain_id: 5, local_part: "alice" });
    const key2 = idempotencyKey("create_mailbox", { domain_id: 5, local_part: "bob" });
    expect(key1).not.toBe(key2);
  });

  it("generates different keys for different tool names", () => {
    const key1 = idempotencyKey("create_mailbox", { id: 1 });
    const key2 = idempotencyKey("create_invite", { id: 1 });
    expect(key1).not.toBe(key2);
  });

  it("uses explicit key when provided", () => {
    const key = idempotencyKey("create_mailbox", { id: 1 }, "my-explicit-key");
    expect(key).toBe("my-explicit-key");
  });

  it("generates key with correct format prefix", () => {
    const key = idempotencyKey("dns_recheck", { domain_id: 42 });
    expect(key).toMatch(/^mcp_dns_recheck_[a-f0-9-]{36}$/);
  });

  it("produces stable keys regardless of param insertion order", () => {
    const key1 = idempotencyKey("test", { a: 1, b: 2 });
    const key2 = idempotencyKey("test", { b: 2, a: 1 });
    expect(key1).toBe(key2);
  });

  it("produces stable keys regardless of nested object insertion order", () => {
    const key1 = idempotencyKey("test", {
      rule: { field: "subject", operator: "contains", value: "invoice" },
    });
    const key2 = idempotencyKey("test", {
      rule: { value: "invoice", operator: "contains", field: "subject" },
    });

    expect(key1).toBe(key2);
  });

  it("includes nested values in the key", () => {
    const key1 = idempotencyKey("test", {
      conditions: [{ field: "subject", operator: "contains", value: "invoice" }],
    });
    const key2 = idempotencyKey("test", {
      conditions: [{ field: "subject", operator: "contains", value: "receipt" }],
    });

    expect(key1).not.toBe(key2);
  });
});
