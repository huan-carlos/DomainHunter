import { readFileSync } from "node:fs";

/**
 * Load a WHOIS contract fixture by base name from ./fixtures/<name>.txt.
 * Fixtures are representative captures of the real Registro.br responses
 * (https://whois.registro.br, port 43).
 */
export function loadFixture(name: string): string {
  return readFileSync(new URL(`./${name}.txt`, import.meta.url), "utf8");
}
