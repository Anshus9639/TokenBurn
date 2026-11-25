import crypto from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, saltB64, hashB64] = stored.split("$");
    if (scheme !== "scrypt" || !n || !saltB64 || !hashB64) return false;
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: SCRYPT_R,
      p: SCRYPT_P,
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export type GeneratedKey = {
  plaintext: string;
  prefix: string;
  lastFour: string;
  hash: string;
};

export function generateApiKey(kind: "live" | "test" = "live"): GeneratedKey {
  const body = crypto.randomBytes(24).toString("hex");
  const plaintext = `tb_${kind}_${body}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, kind === "live" ? 11 : 11),
    lastFour: plaintext.slice(-4),
    hash: sha256(plaintext),
  };
}

export function hashApiKey(plaintext: string): string {
  return sha256(plaintext.trim());
}

function encryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production" && !process.env.AUTH_SECRET) {
      throw new Error("ENCRYPTION_KEY must be set to store provider credentials");
    }
    return crypto.createHash("sha256").update(process.env.AUTH_SECRET ?? "tokenburn-dev-only").digest();
  }
  const buf = Buffer.from(raw, "base64");
  return buf.length === 32 ? buf : crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function signValue(value: string, secret = process.env.AUTH_SECRET ?? "tokenburn-dev-only"): string {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}
