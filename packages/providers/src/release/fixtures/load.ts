import { readFileSync } from "node:fs";

/**
 * Load a release-process contract fixture by base name from ./fixtures/.
 * Fixtures are representative captures of the official Registro.br release
 * process publications (proclib-schedule.json and the plain-text domain
 * lists), recorded on 2026-08-10/11. They freeze the v1 parser behavior
 * (RNF-017, RNF-022) so format drift can be caught in tests.
 */
export function loadFixture(name: string): string {
  const file =
    name.endsWith(".json") || name.endsWith(".html") || name.endsWith(".txt")
      ? name
      : `${name}.txt`;
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}
