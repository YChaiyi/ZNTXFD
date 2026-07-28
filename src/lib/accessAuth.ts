const COOKIE_NAME = "kb_access_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SESSION_VERSION = "v2";
const MIN_SESSION_SECRET_LENGTH = 32;

export const ACCESS_COOKIE_NAME = COOKIE_NAME;
export const ACCESS_COOKIE_MAX_AGE = COOKIE_MAX_AGE;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(value))));
}

function constantTimeEqual(left: string, right: string) {
  const leftBytes = utf8(left);
  const rightBytes = utf8(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function isAccessConfigured() {
  return getAccessConfigurationError() === null;
}

export function getAccessConfigurationError() {
  if (!process.env.ACCESS_PASSWORD) return "ACCESS_PASSWORD is not configured";
  if (!process.env.ACCESS_SESSION_SECRET) return "ACCESS_SESSION_SECRET is not configured";
  if (process.env.ACCESS_SESSION_SECRET.length < MIN_SESSION_SECRET_LENGTH) {
    return `ACCESS_SESSION_SECRET must contain at least ${MIN_SESSION_SECRET_LENGTH} characters`;
  }
  return null;
}

export function isPasswordValid(input: string) {
  const password = process.env.ACCESS_PASSWORD ?? "";
  return Boolean(password) && constantTimeEqual(input, password);
}

async function accessScope(password: string, secret: string) {
  // The opaque scope changes when the fixed password changes, immediately
  // invalidating sessions without exposing a password-derived hash in the cookie.
  return hmac(`access-password:${password}`, secret);
}

export async function createAccessSession(now = Date.now()) {
  const secret = process.env.ACCESS_SESSION_SECRET;
  const password = process.env.ACCESS_PASSWORD;
  const configurationError = getAccessConfigurationError();
  if (configurationError || !secret || !password) {
    throw new Error(configurationError ?? "Access session configuration is incomplete");
  }
  const expiresAt = Math.floor(now / 1000) + COOKIE_MAX_AGE;
  const payload = `${SESSION_VERSION}.${expiresAt}.${await accessScope(password, secret)}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifyAccessSession(value: string | undefined, now = Date.now()) {
  const secret = process.env.ACCESS_SESSION_SECRET;
  const password = process.env.ACCESS_PASSWORD;
  if (!isAccessConfigured() || !secret || !password || !value) return false;
  const [version, expiresAtRaw, scope, signature, extra] = value.split(".");
  if (
    version !== SESSION_VERSION ||
    extra ||
    !/^\d+$/.test(expiresAtRaw ?? "") ||
    !scope ||
    !signature
  ) return false;
  if (Number(expiresAtRaw) <= Math.floor(now / 1000)) return false;
  const expectedScope = await accessScope(password, secret);
  if (!constantTimeEqual(scope, expectedScope)) return false;
  const expected = await hmac(`${version}.${expiresAtRaw}.${scope}`, secret);
  return constantTimeEqual(signature, expected);
}
