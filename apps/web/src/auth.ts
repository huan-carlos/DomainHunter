/**
 * Stateless password auth for the web dashboard (HttpOnly signed cookie).
 *
 * The session token is `<issuedAtMs>.<hmac-sha256(issuedAtMs)>`; the HMAC key
 * is derived from the operator password, so no session store is needed and a
 * password change invalidates every outstanding cookie. No external deps —
 * Node built-ins only.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "domainhunter_session";
export const SESSION_SECONDS = 12 * 60 * 60;

/** HMAC key derived from the operator password. */
export function deriveSecret(password: string): Buffer {
  return createHash("sha256").update(password).digest();
}

/** Constant-time comparison (hash both sides so lengths never leak). */
export function passwordMatches(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function sign(secret: Buffer, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export interface Session {
  token: string;
  /** Raw `set-cookie` header value. */
  cookie: string;
}

export function issueSession(secret: Buffer, nowMs: number): Session {
  const issuedAt = String(nowMs);
  const token = `${issuedAt}.${sign(secret, issuedAt)}`;
  return {
    token,
    cookie: `${AUTH_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
  };
}

export function clearSessionCookie(): string {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readAuthToken(cookieHeader: string | undefined): string | null {
  if (cookieHeader == null) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === AUTH_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

export function isAuthenticated(
  cookieHeader: string | undefined,
  secret: Buffer,
  nowMs: number,
): boolean {
  const token = readAuthToken(cookieHeader);
  if (token == null) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const issuedAt = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(issuedAt)) return false;
  const age = nowMs - Number(issuedAt);
  if (age < 0 || age >= SESSION_SECONDS * 1000) return false;
  const expected = sign(secret, issuedAt);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(
    Buffer.from(signature, "hex"),
    Buffer.from(expected, "hex"),
  );
}

/** Only allow same-origin relative paths as post-login redirect targets. */
export function isSafeNextPath(value: string): boolean {
  return (
    value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
  );
}
