/**
 * Version identity of the Registro.br RDAP client (RNF-016).
 *
 * The version string is recorded on every normalized result so historical
 * decisions can be reproduced with the exact client/parser that produced
 * them. Bump this when the query protocol or the parsing rules change
 * (RNF-023) — each version must remain independently testable.
 */
export const RDAP_CLIENT_VERSION = "rdap-client@v1";
