/**
 * ISAVAIL transport over UDP (Protocolo-ISAVAILv2): a single query packet
 * is sent to `avail.registro.br:43` and a single response packet is read
 * back. Responses are encoded ISO-8859-1 (Latin-1).
 *
 * The socket factory is injectable so contract tests can drive the real
 * UDP path against a local server without touching avail.registro.br.
 */
import { createSocket } from "node:dgram";
import type { Socket } from "node:dgram";
import { isavailTimeout, isavailSourceUnavailable } from "./errors.ts";

export interface IsavailTransportOptions {
  /** ISAVAIL server host (defaults to avail.registro.br). */
  host?: string;
  /** ISAVAIL server port (defaults to 43). */
  port?: number;
  /** Timeout for a single query round-trip (defaults to 5s). */
  timeoutMs?: number;
  /** Max query attempts including the first send (defaults to 3). */
  maxAttempts?: number;
  /** Injectable UDP socket factory for tests. */
  createSocket?: () => Socket;
}

export function queryIsavailRaw(
  domain: string,
  query: string,
  options: IsavailTransportOptions = {},
): Promise<string> {
  const host = options.host ?? "avail.registro.br";
  const port = options.port ?? 43;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const createUdpSocket = options.createSocket ?? (() => createSocket("udp4"));

  return new Promise<string>((resolve, reject) => {
    const socket = createUdpSocket();
    let settled = false;
    let attempts = 0;
    let chunks: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (err: Error | null, raw?: string) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.close();
      } catch {
        // already closed
      }
      if (err) {
        reject(err);
      } else {
        resolve(raw ?? "");
      }
    };

    const armTimeout = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        sendAttempt();
      }, timeoutMs);
    };

    const sendAttempt = () => {
      if (settled) return;
      attempts += 1;
      if (attempts > maxAttempts) {
        finish(isavailTimeout(domain));
        return;
      }
      armTimeout();
      try {
        socket.send(Buffer.from(query, "latin1"), port, host);
      } catch (err) {
        finish(isavailSourceUnavailable(domain, err));
      }
    };

    socket.on("message", (msg) => {
      chunks.push(msg.toString("latin1"));
      finish(null, chunks.join(""));
    });

    socket.on("error", (err) => {
      finish(isavailSourceUnavailable(domain, err));
    });

    socket.bind(() => {
      sendAttempt();
    });
  });
}
