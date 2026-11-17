import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import packageMetadata from "../package.json" with { type: "json" };
import lockMetadata from "../package-lock.json" with { type: "json" };
import { PACKAGE_VERSION } from "../src/config.js";

describe("stdio release metadata", () => {
  it("advertises the installed package version and all 285 tools", async () => {
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
      expect((await client.listTools()).tools).toHaveLength(285);
    } finally {
      await client.close();
    }
  }, 15000);

  /**
   * A release bumps the version in four places (1.18.0: respond_to_invitation,
   * search operators, select=matching and the Drive name search). The server advertises config.ts; the
   * lockfile's own entries and the README's release line must say the same.
   */
  it("keeps config.ts, the lockfile and the README on the package version", () => {
    const readme = readFileSync(fileURLToPath(new URL("../README.md", import.meta.url)), "utf8");

    expect(PACKAGE_VERSION).toBe(packageMetadata.version);
    expect(lockMetadata.version).toBe(packageMetadata.version);
    expect(lockMetadata.packages[""].version).toBe(packageMetadata.version);
    expect(readme).toContain(`Current release: package **${packageMetadata.version}**`);
    expect(readme).toContain(`\`trekmail-mcp/${packageMetadata.version}\``);
  });
});
