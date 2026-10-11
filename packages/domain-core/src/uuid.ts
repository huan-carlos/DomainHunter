import { randomBytes } from "node:crypto";

/**
 * Generate a UUIDv7 string: a 48-bit UTC millisecond timestamp followed by
 * random bits, version nibble 7 and variant bits 10. UUID v7 is time-ordered,
 * so rows sort naturally by creation time.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);

  const millis = Math.floor(now);
  view.setUint32(0, Math.floor(millis / 0x1_0000));
  view.setUint16(4, millis % 0x1_0000);

  const random = randomBytes(10);
  bytes.set(random, 6);

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
