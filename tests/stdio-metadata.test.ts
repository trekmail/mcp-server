import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import packageMetadata from "../package.json" with { type: "json" };

describe("stdio release metadata", () => {
  it("advertises the installed package version and all 280 tools", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)),
        fileURLToPath(new URL("../src/index.ts", import.meta.url)),
      ],
      env: {
        TREKMAIL_BASE_URL: "http://127.0.0.1:1",
        TREKMAIL_API_TOKEN: "tm_live_metadata_test",
        TREKMAIL_MESSAGE_TOKEN: "tm_msg_metadata_test",
        TREKMAIL_SCOPE_AWARE_REGISTRATION: "false",
        TREKMAIL_ALLOW_DESTRUCTIVE: "true",
        TREKMAIL_ALLOW_SENDING: "true",
        TREKMAIL_ALLOW_MIGRATION: "true",
      },
      stderr: "pipe",
    });
    const client = new Client({ name: "release-metadata-test", version: "1.0.0" });
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.version).toBe(packageMetadata.version);
      expect((await client.listTools()).tools).toHaveLength(280);
    } finally {
      await client.close();
    }
  }, 15000);
});
