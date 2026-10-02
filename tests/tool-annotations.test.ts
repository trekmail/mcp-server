import { describe, expect, it } from "vitest";
import { catalogEntryForTool, TOOL_CATALOG } from "../src/tool-catalog.js";
import { toolAnnotations } from "../src/tool-annotations.js";

const hints = (name: string) => toolAnnotations(catalogEntryForTool(name)!);

describe("tool effect annotations", () => {
  it("uses display titles and preserves explicit annotation titles", () => {
    const entry = catalogEntryForTool("get_auto_reply")!;
    expect(toolAnnotations(entry, {}, "Get Auto-Reply").title).toBe("Get Auto-Reply");
    expect(toolAnnotations(entry, { title: "Vacation settings" }, "Get Auto-Reply").title).toBe("Vacation settings");
    expect(toolAnnotations(entry, { title: "   " }, "Get Auto-Reply").title).toBe("Get Auto-Reply");
    expect(toolAnnotations(entry).title).toBe("Get Auto Reply");
  });

  it.each([
    "send_message", "schedule_message", "create_invite", "create_invites_bulk",
    "start_migration", "retry_migration", "delete_migration", "cancel_migration",
    "start_bulk_migration", "retry_bulk_migration", "delete_bulk_migration",
    "cancel_bulk_migration", "resume_bulk_migration", "create_message_token",
    "update_bulk_migration_job_password",
  ])("does not understate irreversible or state-changing %s", (name) => {
    expect(hints(name).readOnlyHint).toBe(false);
    expect(hints(name).destructiveHint).toBe(true);
  });

  it("distinguishes bounded reads, additions, updates and external sends", () => {
    expect(hints("get_account")).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(hints("read_message")).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(hints("create_contact")).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(hints("update_contact").destructiveHint).toBe(true);
    expect(hints("send_message").openWorldHint).toBe(true);
    expect(hints("apply_cloudflare_dns").openWorldHint).toBe(true);
    expect(hints("drive_share_create").openWorldHint).toBe(true);
  });

  it("preserves explicit destructive warnings on additive operations", () => {
    expect(toolAnnotations(catalogEntryForTool("create_contact")!, { destructiveHint: true }).destructiveHint).toBe(true);
  });

  it.each([
    "set_forwarding", "create_forwarding_address", "update_domain_catch_all",
    "create_mail_rule", "update_mail_rule", "set_auto_reply", "upload_sieve_script",
  ])("flags deferred external mail effects for %s", (name) => {
    expect(hints(name).readOnlyHint).toBe(false);
    expect(hints(name).openWorldHint).toBe(true);
  });

  it("always supplies all three booleans for the complete catalog", () => {
    for (const entry of TOOL_CATALOG) {
      for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint"]) {
        expect(typeof toolAnnotations(entry)[key], `${entry.name}: ${key}`).toBe("boolean");
      }
    }
  });
});
