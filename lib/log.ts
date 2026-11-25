import { redactSecrets } from "./providers";

type LogLevel = "info" | "warn" | "error";

const SECRET_FIELD = /(api[-_]?key|authorization|token|secret|password|credential)/i;
const MAX_STRING = 500;
const MAX_DEPTH = 2;

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redactSecrets(value.slice(0, MAX_STRING));
  if (value instanceof Error) {
    return { name: value.name, message: redactSecrets(value.message).slice(0, MAX_STRING) };
  }
  if (Array.isArray(value)) {
    return depth >= MAX_DEPTH ? "[array]" : value.slice(0, 5).map((entry) => sanitize(entry, depth + 1));
  }
  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "[object]";
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_FIELD.test(key) ? "[redacted]" : sanitize(entry, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Emits one JSON line per event. Field names that look sensitive are masked outright and
 *  credential-shaped substrings inside values are redacted before serialization. */
export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  let line: string;
  try {
    line = JSON.stringify({ ...(sanitize(fields) as Record<string, unknown>), ts: new Date().toISOString(), level, event });
  } catch {
    line = JSON.stringify({ ts: new Date().toISOString(), level, event, logError: "unserializable fields" });
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
