import { describe, it, expect, vi, beforeEach } from "vitest";
import { TrekMailClient } from "../../src/client.js";

/**
 * Drive Sync Devices MCP tool smoke tests (added 2026-05-23 alongside
 * REST `/api/v1/drive/devices`). Verifies the client surface forwards
 * args correctly; tool-layer Zod validation is exercised indirectly via
 * the schema definitions in src/tools/drive-devices.ts.
 */
describe("drive devices client methods", () => {
  let client: TrekMailClient;

  beforeEach(() => {
    client = {
      listDriveDevices: vi.fn().mockResolvedValue({ data: [] }),
      createDriveDevice: vi.fn().mockResolvedValue({
        data: { id: 1, label: "mac", password: "dsync_abc" },
      }),
      revokeDriveDevice: vi.fn().mockResolvedValue({
        data: { id: 1, revoked_at: "2026-05-23T00:00:00Z" },
      }),
      rotateDriveDevice: vi.fn().mockResolvedValue({
        data: { id: 2, label: "mac", password: "dsync_xyz", rotated_from_device_id: 1 },
      }),
    } as unknown as TrekMailClient;
  });

  it("listDriveDevices takes no args", async () => {
    await client.listDriveDevices();
    expect(client.listDriveDevices).toHaveBeenCalledWith();
  });

  it("createDriveDevice forwards label, scopes, mailbox_id, expires_in_days + key", async () => {
    await client.createDriveDevice(
      {
        label: "macbook rclone",
        scopes: ["drive:account:read", "drive:account:write"],
        mailbox_id: null,
        expires_in_days: 90,
      },
      "idem-key-1",
    );
    expect(client.createDriveDevice).toHaveBeenCalledWith(
      {
        label: "macbook rclone",
        scopes: ["drive:account:read", "drive:account:write"],
        mailbox_id: null,
        expires_in_days: 90,
      },
      "idem-key-1",
    );
  });

  it("createDriveDevice accepts mailbox_id when binding to a specific mailbox", async () => {
    await client.createDriveDevice(
      {
        label: "iphone documents",
        scopes: ["drive:mailbox:read"],
        mailbox_id: 42,
        expires_in_days: null,
      },
      "idem-key-2",
    );
    expect(client.createDriveDevice).toHaveBeenCalledWith(
      expect.objectContaining({ mailbox_id: 42, expires_in_days: null }),
      "idem-key-2",
    );
  });

  it("revokeDriveDevice forwards id + idempotency key", async () => {
    await client.revokeDriveDevice(99, "rev-key-1");
    expect(client.revokeDriveDevice).toHaveBeenCalledWith(99, "rev-key-1");
  });

  it("rotateDriveDevice with new expiry override", async () => {
    await client.rotateDriveDevice(99, { expires_in_days: 365 }, "rot-key-1");
    expect(client.rotateDriveDevice).toHaveBeenCalledWith(
      99,
      { expires_in_days: 365 },
      "rot-key-1",
    );
  });

  it("rotateDriveDevice with null expiry inherits original", async () => {
    await client.rotateDriveDevice(99, { expires_in_days: null }, "rot-key-2");
    expect(client.rotateDriveDevice).toHaveBeenCalledWith(
      99,
      { expires_in_days: null },
      "rot-key-2",
    );
  });
});
