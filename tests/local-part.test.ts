import { describe, expect, it } from "vitest";
import { ALIAS_LOCAL_PART_PATTERN, LOCAL_PART_PATTERN } from "../src/tools/util.js";

// Mirrors App\Rules\MailboxLocalPart (tests/Unit/Rules/MailboxLocalPartContractTest.php
// checks the PHP side against this same pattern).
describe("LOCAL_PART_PATTERN", () => {
  it.each(["a", "0", "_", "testuser", "_sales", "pure_", "abc-", "a.b", "a.-b", "a_.b"])(
    "accepts %s",
    (value) => {
      expect(LOCAL_PART_PATTERN.test(value)).toBe(true);
    },
  );

  it.each([
    "", "-", "-abc", ".abc", "abc.", "a..b", ".", "ABC", "a+b", "a b", "a/b",
    "alice_archived_20260611_095506", "alice_archived_20260821_044525_1_2976525",
  ])(
    "refuses %s",
    (value) => {
      expect(LOCAL_PART_PATTERN.test(value)).toBe(false);
    },
  );
});

// Mirrors App\Rules\AliasLocalPart: aliases never reach doveadm, so a leading
// hyphen stays allowed there.
describe("ALIAS_LOCAL_PART_PATTERN", () => {
  it.each(["sales", "-sales", "_x", "a.b", "a-b.c_d"])("accepts %s", (value) => {
    expect(ALIAS_LOCAL_PART_PATTERN.test(value)).toBe(true);
  });

  it.each(["", ".sales", "sales.", "a..b", "a+b", "ABC"])("refuses %s", (value) => {
    expect(ALIAS_LOCAL_PART_PATTERN.test(value)).toBe(false);
  });
});
