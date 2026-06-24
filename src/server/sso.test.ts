/* Tests for the pure SSO helpers (G-28). The live OIDC handshake needs a real
   IdP and is not exercised here; these pin the security-relevant pure logic:
   the feature is off unless every OIDC_* var is set, only verified emails
   resolve an account, and the state cookie is tamper-evident. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeState, emailFromClaims, encodeState, ssoConfig, ssoEnabled } from "./sso";

const OIDC_VARS = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI"] as const;

describe("ssoConfig / ssoEnabled", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of OIDC_VARS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.SESSION_SECRET = process.env.SESSION_SECRET || "x".repeat(32);
  });
  afterEach(() => {
    for (const k of OIDC_VARS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });

  it("is disabled when no OIDC vars are set", () => {
    expect(ssoEnabled()).toBe(false);
    expect(ssoConfig()).toBeNull();
  });

  it("is disabled when only some vars are set", () => {
    process.env.OIDC_ISSUER = "https://idp.example.com";
    process.env.OIDC_CLIENT_ID = "abc";
    expect(ssoEnabled()).toBe(false);
  });

  it("is enabled and reads config when all four are set", () => {
    process.env.OIDC_ISSUER = "https://idp.example.com";
    process.env.OIDC_CLIENT_ID = "abc";
    process.env.OIDC_CLIENT_SECRET = "shh";
    process.env.OIDC_REDIRECT_URI = "https://app.example.com/api/auth/sso/callback";
    expect(ssoEnabled()).toBe(true);
    expect(ssoConfig()).toEqual({
      issuer: "https://idp.example.com", clientId: "abc", clientSecret: "shh",
      redirectUri: "https://app.example.com/api/auth/sso/callback",
    });
  });
});

describe("emailFromClaims", () => {
  it("lowercases and trims a verified email", () => {
    expect(emailFromClaims({ email: "  Maya@Example.com ", email_verified: true })).toBe("maya@example.com");
  });
  it("rejects when email_verified is absent (treat unknown as unverified)", () => {
    expect(emailFromClaims({ email: "sam@example.com" })).toBeNull();
  });
  it("rejects an explicitly unverified email", () => {
    expect(emailFromClaims({ email: "sam@example.com", email_verified: false })).toBeNull();
  });
  it("rejects a missing or malformed email", () => {
    expect(emailFromClaims({})).toBeNull();
    expect(emailFromClaims({ email: "not-an-email" })).toBeNull();
    expect(emailFromClaims({ email: 123 })).toBeNull();
  });
});

describe("state cookie encode/decode", () => {
  beforeEach(() => { process.env.SESSION_SECRET = process.env.SESSION_SECRET || "x".repeat(32); });
  const st = { state: "s1", nonce: "n1", codeVerifier: "v1" };

  it("round-trips a valid signed cookie", () => {
    expect(decodeState(encodeState(st))).toEqual(st);
  });
  it("rejects a tampered payload", () => {
    const cookie = encodeState(st);
    const [, sig] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ ...st, state: "evil" })).toString("base64url") + "." + sig;
    expect(decodeState(forged)).toBeNull();
  });
  it("rejects malformed or empty input", () => {
    expect(decodeState(undefined)).toBeNull();
    expect(decodeState("garbage")).toBeNull();
    expect(decodeState("a.b")).toBeNull();
  });
  it("rejects a valid cookie extended with trailing garbage", () => {
    const cookie = encodeState(st);
    expect(decodeState(cookie + ".extra")).toBeNull();
  });
});
