import { readFileSync } from "node:fs";

/**
 * Load an RDAP contract fixture by base name from ./fixtures/<name>.json.
 * Fixtures are representative captures of the real Registro.br RDAP
 * responses (https://rdap.registro.br/domain/{domain}).
 */
export function loadFixture(name: string): string {
  return readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8");
}
