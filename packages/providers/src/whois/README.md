# WHOIS client — Registro.br (`whois-client@v1`)

Versioned client for the textual WHOIS service of the Registro.br registry
(`whois.registro.br`, port 43). Implements the provider contract
`WhoisProvider` in `@domainhunter/providers` (RNF-015, RNF-022).

## Protocol

- RFC 3912 WHOIS over TCP: connect to `whois.registro.br:43`, send
  `<domain>\r\n`, read the textual response until the server closes.
- Only exact-match domain queries are supported by the registry.
- Responses are plain text with `key: value` lines; comment lines start
  with `%`.
- The registry serves ISO-8859-1 (Latin-1); responses are decoded as
  Latin-1 so accented registrant names survive (UTF-8 decoding would
  corrupt them).

## Versioning (RNF-016, RNF-023)

- Every normalized record carries `sourceVersion: "whois-client@v1"`
  (constant `WHOIS_CLIENT_VERSION`), recorded on `domain_events` so
  historical decisions can be reproduced with the exact parser.
- The parser (`parser.ts`) and transport (`transport.ts`) are independent
  modules paired through the client factory (`client.ts`). Bump the version
  constant when query protocol or parsing rules change and keep the old
  parser/test fixtures under their own version.

## Normalized record

`WhoisRecord` (see `whois-provider.ts`) extracts:

| Registro.br field | Normalized field |
|---|---|
| `domain` | `domain` (from query) |
| — | `exists` (registration record present) |
| `owner` | `owner` (titular) |
| `ownerid` | `ownerId` (identificador do titular) |
| `responsible` | `responsible` |
| `country` | `country` |
| `owner-c` / `tech-c` / `billing-c` | `ownerContact` / `techContact` / `billingContact` |
| `created` / `changed` / `expires` | `createdAt` / `changedAt` / `expiresAt` (ISO-8601 UTC) |
| `status` | `status[]` |
| `nserver` | `nameServers[]` |
| full reply | `raw` (preserved for audit, RNF-007) |

## Technical errors

`WhoisError` with an identifiable `code` (product brief §23). These are
technical failures, never domain verdicts (RNF-001, RNF-020).

| Code | When |
|---|---|
| `WHOIS_TIMEOUT` | No response within the configured timeout |
| `RATE_LIMIT` | Registry replies `Query rate limit exceeded` |
| `PARSER_ERROR` | Response has no recognizable structure |
| `SOURCE_UNAVAILABLE` | TCP connect fails (refused, DNS, reset) |

## Usage

```ts
import { createWhoisClientV1 } from "@domainhunter/providers";

const client = createWhoisClientV1({ timeoutMs: 10_000 });
const record = await client.query("domainhunter.com.br");
// record.raw is the preserved audit evidence
```

## Testing

- `parser.test.ts` — contract tests against real captured fixtures under
  `fixtures/` (registered, thin registered, not-found, rate-limit, invalid).
- `transport.test.ts` — drives the real TCP code path against a local
  server to cover registered/not-found/rate-limit/parser-error/timeout/
  source-unavailable.
