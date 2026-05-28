import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test loadConfig by manipulating env vars and dynamically importing
describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  async function loadConfig() {
    // Dynamic import to pick up fresh env vars
    const mod = await import("../src/config.js");
    return mod.loadConfig();
  }

  it("fails with clear error when TREKMAIL_BASE_URL is missing", async () => {
    process.env.TREKMAIL_API_TOKEN = "tm_live_test123";
    delete process.env.TREKMAIL_BASE_URL;

    await expect(loadConfig()).rejects.toThrow("process.exit called");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("TREKMAIL_BASE_URL"),
    );
  });

  it("fails when no tokens are provided", async () => {
    process.env.TREKMAIL_BASE_URL = "https://trekmail.test";
    delete process.env.TREKMAIL_API_TOKEN;
    delete process.env.TREKMAIL_MESSAGE_TOKEN;

    await expect(loadConfig()).rejects.toThrow("process.exit called");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("At least one"),
    );
  });

  it("succeeds with only ops token", async () => {
    process.env.TREKMAIL_BASE_URL = "https://trekmail.test";
    process.env.TREKMAIL_API_TOKEN = "tm_live_abc123";
    delete process.env.TREKMAIL_MESSAGE_TOKEN;

    const config = await loadConfig();
    expect(config.apiToken).toBe("tm_live_abc123");
    expect(config.messageToken).toBeUndefined();
  });

  it("succeeds with only message token", async () => {
    process.env.TREKMAIL_BASE_URL = "https://trekmail.test";
    delete process.env.TREKMAIL_API_TOKEN;
    process.env.TREKMAIL_MESSAGE_TOKEN = "tm_msg_xyz789";

    const config = await loadConfig();
    expect(config.apiToken).toBeUndefined();
    expect(config.messageToken).toBe("tm_msg_xyz789");
  });

  it("succeeds with both tokens", async () => {
    process.env.TREKMAIL_BASE_URL = "https://trekmail.test";
    process.env.TREKMAIL_API_TOKEN = "tm_live_abc123";
    process.env.TREKMAIL_MESSAGE_TOKEN = "tm_msg_xyz789";

    const config = await loadConfig();
    expect(config.apiToken).toBe("tm_live_abc123");
    expect(config.messageToken).toBe("tm_msg_xyz789");
  });

  it("validates ops token format must start with tm_live_", async () => {
    process.env.TREKMAIL_BASE_URL = "https://trekmail.test";
    process.env.TREKMAIL_API_TOKEN = "bad_token";

    await expect(loadConfig()).rejects.toThrow("process.exit called");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("apiToken"),
    );
  });

  it("validates message token format must start with tm_msg_", async () => {
    process.env.TREKMAIL_BASE_URL = "https://trekmail.test";
    process.env.TREKMAIL_MESSAGE_TOKEN = "bad_msg_token";

    await expect(loadConfig()).rejects.toThrow("process.exit called");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("messageToken"),
    );
  });

  it("parses all env vars correctly with defaults", async () => {
    process.env.TREKMAIL_BASE_URL = "https://trekmail.test/";
    process.env.TREKMAIL_API_TOKEN = "tm_live_abc123";

    const config = await loadConfig();

    expect(config.baseUrl).toBe("https://trekmail.test"); // trailing slash stripped
    expect(config.apiToken).toBe("tm_live_abc123");
    expect(config.timeoutMs).toBe(30_000);
    expect(config.userAgent).toBe("trekmail-mcp/1.0.4");
    expect(config.allowDestructive).toBe(false);
    expect(config.allowSending).toBe(false);
  });

  it("parses custom env var values", async () => {
    process.env.TREKMAIL_BASE_URL = "https://custom.test";
    process.env.TREKMAIL_API_TOKEN = "tm_live_xyz";
    process.env.TREKMAIL_TIMEOUT_MS = "5000";
    process.env.TREKMAIL_USER_AGENT = "my-agent/2.0";
    process.env.TREKMAIL_ALLOW_DESTRUCTIVE = "true";
    process.env.TREKMAIL_ALLOW_SENDING = "true";

    const config = await loadConfig();

    expect(config.timeoutMs).toBe(5000);
    expect(config.userAgent).toBe("my-agent/2.0");
    expect(config.allowDestructive).toBe(true);
    expect(config.allowSending).toBe(true);
  });

  it("allowSending defaults to false", async () => {
    process.env.TREKMAIL_BASE_URL = "https://trekmail.test";
    process.env.TREKMAIL_MESSAGE_TOKEN = "tm_msg_test";

    const config = await loadConfig();
    expect(config.allowSending).toBe(false);
  });
});
