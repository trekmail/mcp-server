import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.TREKMAIL_E2E_BASE_URL;
const apiToken = process.env.TREKMAIL_E2E_API_TOKEN;
const mailboxId = Number(process.env.TREKMAIL_E2E_MAILBOX_ID);

if (!baseUrl || !apiToken || !Number.isInteger(mailboxId) || mailboxId <= 0) {
  throw new Error(
    "Set TREKMAIL_E2E_BASE_URL, TREKMAIL_E2E_API_TOKEN, and a positive TREKMAIL_E2E_MAILBOX_ID.",
  );
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL("../../build/index.js", import.meta.url))],
  env: {
    TREKMAIL_BASE_URL: baseUrl,
    TREKMAIL_API_TOKEN: apiToken,
    TREKMAIL_TIMEOUT_MS: "10000",
  },
  stderr: "pipe",
});
const client = new Client({ name: "trekmail-mail-client-setup-e2e", version: "1.0.0" });

function jsonText(result) {
  if (result.isError) {
    throw new Error(`MCP tool returned an error: ${JSON.stringify(result.content)}`);
  }
  const text = result.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("MCP tool returned no text content.");
  return JSON.parse(text);
}

try {
  await client.connect(transport);

  const listed = await client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const required of ["get_mail_client_setup", "get_apple_mail_profile"]) {
    if (!names.has(required)) throw new Error(`tools/list is missing ${required}`);
  }

  const setup = jsonText(await client.callTool({
    name: "get_mail_client_setup",
    arguments: { mailbox_id: mailboxId, locale: "ru" },
  }));
  if (setup?.data?.sending?.ready !== true) throw new Error("Sending is not ready in setup result.");
  if (setup?.data?.authentication?.password_included !== false) {
    throw new Error("Setup result does not explicitly guarantee that the password is absent.");
  }
  if (!setup?.data?.incoming?.host || !setup?.data?.outgoing?.host) {
    throw new Error("Setup result is missing IMAP or SMTP host settings.");
  }
  if (setup?.data?.language !== "ru" || setup?.data?.clients?.length !== 5) {
    throw new Error("Setup result is missing the requested localized client guides.");
  }
  if (!setup.data.clients.some((guide) => guide.id === "gmail" && guide.steps?.length === 3)) {
    throw new Error("Setup result is missing the Gmail three-step guide.");
  }

  const profile = jsonText(await client.callTool({
    name: "get_apple_mail_profile",
    arguments: { mailbox_id: mailboxId, locale: "ru" },
  }));
  if (profile.encoding !== "base64" || profile.password_included !== false) {
    throw new Error("Apple profile metadata is unsafe or incomplete.");
  }
  const xml = Buffer.from(profile.content_base64, "base64").toString("utf8");
  if (!xml.includes("<plist") || !xml.includes(setup.data.mailbox.email)) {
    throw new Error("Decoded Apple profile is not a profile for the requested mailbox.");
  }
  if (!xml.includes("Настраивает")) {
    throw new Error("Decoded Apple profile did not use the requested Russian locale.");
  }
  if (xml.includes("E2E-Secret-Must-Not-Appear")) {
    throw new Error("Decoded Apple profile exposed the mailbox password.");
  }
  if (xml.includes("<key>IncomingPassword</key>") || xml.includes("<key>OutgoingPassword</key>")) {
    throw new Error("Decoded Apple profile contains a password field.");
  }

  const outsideConstraint = await client.callTool({
    name: "get_mail_client_setup",
    arguments: { mailbox_id: mailboxId + 1 },
  });
  const outsideText = outsideConstraint.content.find((item) => item.type === "text")?.text ?? "";
  if (!outsideConstraint.isError || !outsideText.includes("not_found")) {
    throw new Error("Mailbox constraints were not enforced through MCP.");
  }

  process.stdout.write(JSON.stringify({
    ok: true,
    listed_tools: listed.tools.length,
    verified_tools: ["get_mail_client_setup", "get_apple_mail_profile"],
    constraint_error_verified: true,
    mailbox_id: mailboxId,
    profile_bytes: Buffer.byteLength(xml),
  }) + "\n");
} finally {
  await client.close();
}
