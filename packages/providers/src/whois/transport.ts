import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { sourceUnavailable, whoisTimeout } from "./errors.ts";

/**
 * WHOIS transport over TCP (RFC 3912): connect to the registry's port 43,
 * send the query as `<domain>\r\n`, read the textual response until the
 * server closes the connection.
 *
 * The response is decoded as Latin-1: whois.registro.br serves ISO-8859-1,
 * so UTF-8 decoding would corrupt accented registrant names. The connect
 * function is injectable so contract tests can drive the real TCP path
 * against a local server without touching whois.registro.br.
 */

export interface WhoisTransportOptions {
  /** WHOIS server host (defaults to whois.registro.br). */
  host?: string;
  /** WHOIS server port (defaults to 43). */
  port?: number;
  /** Timeout for the whole query round-trip. */
  timeoutMs?: number;
  /** Injectable socket factory for tests. */
  connect?: (host: string, port: number) => Socket;
}

export function queryWhoisRaw(domain: string, options: WhoisTransportOptions = {}): Promise<string> {
  const host = options.host ?? "whois.registro.br";
  const port = options.port ?? 43;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const connect = options.connect ?? ((h: string, p: number) => createConnection({ host: h, port: p }));

  return new Promise<string>((resolve, reject) => {
    const socket = connect(host, port);
    let settled = false;
    let chunks: string[] = [];

    const finish = (err: Error | null, raw?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      if (err) {
        socket.destroy();
        reject(err);
      } else {
        socket.destroy();
        resolve(raw ?? "");
      }
    };

    const timer = setTimeout(() => {
      finish(whoisTimeout(domain));
    }, timeoutMs);

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => {
      finish(whoisTimeout(domain));
    });

    socket.on("error", (err) => {
      finish(sourceUnavailable(domain, err));
    });

    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk.toString("latin1"));
    });

    socket.on("end", () => {
      finish(null, chunks.join(""));
    });

    socket.on("close", () => {
      finish(null, chunks.join(""));
    });

    socket.write(`${domain}\r\n`);
  });
}
