import { describe, it, expect } from "vitest";
import { isPrivateHost } from "../../src/tools/util.js";

/**
 * Ticket #163 BUG #2 — bypass classes for the earlier naive string-match
 * implementation of isPrivateHost. The hardened version added in 2026-05-27
 * normalizes IPv4 across notations, parses bracketed IPv6, catches
 * IPv4-mapped IPv6, and broadens the metadata/localhost surface.
 *
 * Backend is the primary defense (App\Rules\SafeExternalHost does DNS
 * resolution + range check); this MCP-layer check is the early-fail.
 */
describe("isPrivateHost", () => {
  describe("legitimate public hosts pass through", () => {
    it.each([
      "smtp.gmail.com",
      "outlook.office365.com",
      "imap.yandex.com",
      "8.8.8.8",
      "1.1.1.1",
      "example.com",
      "2606:4700:4700::1111", // Cloudflare DNS IPv6
    ])("permits %s", (host) => {
      expect(isPrivateHost(host)).toBe(false);
    });
  });

  describe("dotted-decimal IPv4 loopback + private ranges", () => {
    it.each([
      "127.0.0.1",
      "127.255.255.254",
      "10.0.0.1",
      "10.255.255.255",
      "192.168.1.1",
      "172.16.0.1",
      "172.31.255.254",
      "169.254.169.254", // AWS / Azure / GCP IMDS
      "100.100.100.200", // Alibaba Cloud IMDS (ticket #171, 2026-05-28)
      "0.0.0.0",
      "255.255.255.255",
      "224.0.0.1", // multicast
    ])("blocks %s", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });

    it("does NOT over-block neighbours of 100.100.100.200", () => {
      // 100.100.100.200/32 is the precise Alibaba IMDS — adjacent IPs
      // are public CGNAT-adjacent space (RFC 6598 is 100.64.0.0/10 but
      // that's separate); we narrow strictly to the IMDS IP.
      expect(isPrivateHost("100.100.100.199")).toBe(false);
      expect(isPrivateHost("100.100.100.201")).toBe(false);
      expect(isPrivateHost("100.100.99.200")).toBe(false);
    });
  });

  describe("IPv4 octal notation (#163 BUG #2 bypass A)", () => {
    it.each(["0177.0.0.1", "0177.000.000.001"])("blocks octal %s", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });
  });

  describe("IPv4 hex notation", () => {
    it.each(["0x7f.0.0.1", "0x7f000001"])("blocks hex %s", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });
  });

  describe("IPv4 single 32-bit int notation", () => {
    it.each([
      "2130706433", // 127.0.0.1
      "167772161", // 10.0.0.1
      "3232235521", // 192.168.0.1
    ])("blocks integer %s", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });
  });

  describe("IPv6 (#163 BUG #2 bypass C)", () => {
    it.each([
      "::1",
      "::",
      "[::]",
      "[::1]",
      "0:0:0:0:0:0:0:0",
      "0:0:0:0:0:0:0:1",
      "fe80::1",
      "fc00::1",
      "fd00::1",
    ])("blocks IPv6 %s", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });

    it("blocks IPv4-mapped IPv6", () => {
      expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
    });
  });

  describe("hostname literals", () => {
    it.each([
      "localhost",
      "Localhost",
      " LOCALHOST ", // case + whitespace normalized
      "localhost.localdomain",
      "service.localhost",
      "metadata.google.internal",
      "metadata.azure.com",
      "instance-data",
      "100-100-100-200.aliyuncs.com", // Alibaba IMDS hostname form (ticket #171)
    ])("blocks hostname %s", (host) => {
      expect(isPrivateHost(host)).toBe(true);
    });
  });

  describe("public hosts that look private-ish but resolve externally", () => {
    // DNS-resolution bypasses (e.g. 127.0.0.1.nip.io) are caught at the
    // backend, not here. Document the behavior explicitly so future readers
    // know it's a known-permitted class at the MCP layer.
    it("permits 127.0.0.1.nip.io (DNS-resolution bypass — backend catches)", () => {
      expect(isPrivateHost("127.0.0.1.nip.io")).toBe(false);
    });
    it("permits localtest.me (resolves to 127.0.0.1 — backend catches)", () => {
      expect(isPrivateHost("localtest.me")).toBe(false);
    });
  });
});
