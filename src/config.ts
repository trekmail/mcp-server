import { z } from "zod";

const configSchema = z
  .object({
    baseUrl: z
      .string()
      .url()
      .transform((url) => url.replace(/\/+$/, "")),
    apiToken: z.string().startsWith("tm_live_").optional(),
    messageToken: z.string().startsWith("tm_msg_").optional(),
    timeoutMs: z.coerce.number().int().positive().default(30_000),
    userAgent: z.string().default("trekmail-mcp/1.0.2"),
    allowDestructive: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    allowSending: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    allowMigration: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    // Internal flag — set by mcp-http when wrapping the stdio tools
    // behind the HTTP transport. Tools that operate on the MCP host
    // filesystem (drive_file_upload) skip registration when true,
    // because "local" means "our server" in that context (ticket #170).
    httpTransport: z.boolean().optional().default(false),
  })
  .refine((data) => data.apiToken || data.messageToken, {
    message:
      "At least one of TREKMAIL_API_TOKEN or TREKMAIL_MESSAGE_TOKEN must be provided",
    path: ["apiToken"],
  });

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const raw = {
    baseUrl: process.env.TREKMAIL_BASE_URL,
    apiToken: process.env.TREKMAIL_API_TOKEN || undefined,
    messageToken: process.env.TREKMAIL_MESSAGE_TOKEN || undefined,
    timeoutMs: process.env.TREKMAIL_TIMEOUT_MS,
    userAgent: process.env.TREKMAIL_USER_AGENT,
    allowDestructive: process.env.TREKMAIL_ALLOW_DESTRUCTIVE,
    allowSending: process.env.TREKMAIL_ALLOW_SENDING,
    allowMigration: process.env.TREKMAIL_ALLOW_MIGRATION,
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    const envHints: Record<string, string> = {
      baseUrl:
        "Set TREKMAIL_BASE_URL to your TrekMail instance URL (e.g. https://trekmail.net)",
      apiToken:
        "Set TREKMAIL_API_TOKEN (tm_live_...) and/or TREKMAIL_MESSAGE_TOKEN (tm_msg_...). At least one is required.",
    };

    const hints = result.error.issues
      .map((i) => envHints[String(i.path[0])])
      .filter(Boolean)
      .map((h) => `  ${h}`)
      .join("\n");

    const message = `FATAL: Invalid configuration:\n${issues}${hints ? `\n\n${hints}` : ""}`;

    console.error(message);
    process.exit(1);
  }

  return result.data;
}
