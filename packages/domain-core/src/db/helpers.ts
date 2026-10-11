/** Current UTC instant as an ISO-8601 string (e.g. `2026-08-11T16:00:00.000Z`). */
export function now(): string {
  return new Date().toISOString();
}

/** Serialize a value to JSON for a TEXT column. */
export function toJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Parse a JSON TEXT column back to a value; null/undefined input becomes null. */
export function fromJson<T>(value: string | null | undefined): T | null {
  if (value == null) return null;
  return JSON.parse(value) as T;
}
