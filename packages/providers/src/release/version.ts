/**
 * Version identity of the Registro.br release process collector (RNF-016).
 *
 * The version string is recorded on every normalized record and on every
 * release event so historical decisions can be reproduced with the exact
 * parser/client that produced them (RNF-023). Bump this when the source
 * format or the parsing rules change — each version must remain
 * independently testable.
 */
export const RELEASE_COLLECTOR_VERSION = "release-collector@v1";
