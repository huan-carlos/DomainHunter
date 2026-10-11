/**
 * Version identity of the Registro.br WHOIS client (RNF-016).
 *
 * The version string is recorded on every normalized record so historical
 * decisions can be reproduced with the exact parser/protocol that produced
 * them. Bump this when the query protocol or the parsing rules change
 * (RNF-023) — each version must remain independently testable.
 */
export const WHOIS_CLIENT_VERSION = "whois-client@v1";
