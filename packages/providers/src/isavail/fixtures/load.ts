import { readFileSync } from "node:fs";

/**
 * Load an ISAVAIL contract fixture by base name from ./fixtures/<name>.txt.
 * Fixtures are representative captures of the real Registro.br ISAVAIL
 * replies (Protocolo-ISAVAILv2, avail.registro.br, UDP/43), including the
 * cookie handshake line where applicable.
 */
export function loadFixture(name: string): string {
  return readFileSync(new URL(`./${name}.txt`, import.meta.url), "utf8");
}
