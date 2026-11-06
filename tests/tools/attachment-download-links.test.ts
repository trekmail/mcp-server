import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../src/config.js";
import { TrekMailClient } from "../../src/client.js";
import { TrekMailApiError } from "../../src/errors.js";
import { registerMessageToolHandlers } from "../../src/tools/messages.js";

const config: Config = {
  baseUrl: "https://test.invalid",
  messageToken: "tm_msg_test",
  timeoutMs: 30_000,
  userAgent: "test",
  allowDestructive: false,
  allowSending: false,
  allowMigration: false,
};

const LINK = {
  uid: 42,
  index: 0,
  filename: "video.mp4",
  content_type: "video/mp4",
  size_bytes: 314_572_800,
  download_url: "https://test.invalid/api/v1/attachment-downloads/" + "a".repeat(64),
  expires_at: "2026-11-05T12:05:00Z",
};

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function harness(overrides: Record<string, unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    downloadAttachment: vi.fn().mockResolvedValue({ content_base64: "YWJj" }),
    downloadAllAttachments: vi.fn().mockResolvedValue({ content_base64: "UEsF" }),
    getAttachmentDownloadUrl: vi.fn().mockResolvedValue(LINK),
    getAttachmentsDownloadUrl: vi.fn().mockResolvedValue({ ...LINK, filename: "attachments.zip", count: 3 }),
    ...overrides,
  } as unknown as TrekMailClient;
  const handlers = new Map<string, Handler>();
  const original = server.registerTool.bind(server);
  server.registerTool = ((name: string, definition: unknown, handler: never) => {
    handlers.set(name, handler);
    return original(name, definition as Parameters<typeof original>[1], handler);
  }) as typeof server.registerTool;
  registerMessageToolHandlers(server, client, config);

  return { client, handlers };
}

const tooLarge = () =>
  new TrekMailApiError(413, "attachment_too_large", "Attachment exceeds 25 MB size limit.");

describe("attachment download links", () => {
  let h: ReturnType<typeof harness>;

  beforeEach(() => {
    h = harness({});
  });

  it("keeps returning small files inline", async () => {
    const result = await h.handlers.get("download_attachment")!({ uid: 42, index: 0 });

    expect(JSON.parse(result.content[0].text)).toEqual({ content_base64: "YWJj" });
    expect(h.client.getAttachmentDownloadUrl).not.toHaveBeenCalled();
  });

  it("answers a file over 25 MB with a link instead of an error", async () => {
    h = harness({ downloadAttachment: vi.fn().mockRejectedValue(tooLarge()) });

    const result = await h.handlers.get("download_attachment")!({ uid: 42, index: 0, folder: "Archive" });
    const body = JSON.parse(result.content[0].text);

    expect(result.isError).toBeUndefined();
    expect(body.download_url).toBe(LINK.download_url);
    expect(body.size_bytes).toBe(LINK.size_bytes);
    expect(body.note).toContain("plain HTTP GET");
    expect(h.client.getAttachmentDownloadUrl).toHaveBeenCalledWith(42, 0, { folder: "Archive", external_account_id: undefined });
  });

  it("gives only the link when asked, without moving the bytes", async () => {
    const result = await h.handlers.get("download_attachment")!({ uid: 42, index: 0, link_only: true, external_account_id: 7 });

    expect(JSON.parse(result.content[0].text).download_url).toBe(LINK.download_url);
    expect(h.client.downloadAttachment).not.toHaveBeenCalled();
    expect(h.client.getAttachmentDownloadUrl).toHaveBeenCalledWith(42, 0, { folder: undefined, external_account_id: 7 });
  });

  it("does the same for all attachments as one ZIP", async () => {
    h = harness({ downloadAllAttachments: vi.fn().mockRejectedValue(new TrekMailApiError(413, "attachments_too_large", "too big")) });

    const body = JSON.parse((await h.handlers.get("download_all_attachments")!({ uid: 42 })).content[0].text);

    expect(body.filename).toBe("attachments.zip");
    expect(body.count).toBe(3);
    expect(body.note).toContain("over 25 MB");
  });

  it("still reports any other failure", async () => {
    h = harness({ downloadAttachment: vi.fn().mockRejectedValue(new TrekMailApiError(404, "not_found", "Attachment not found.")) });

    const result = await h.handlers.get("download_attachment")!({ uid: 42, index: 9 });

    expect(result.isError).toBe(true);
    expect(h.client.getAttachmentDownloadUrl).not.toHaveBeenCalled();
  });
});
