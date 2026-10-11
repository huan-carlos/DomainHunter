# ISAVAIL client — Registro.br (`isavail-client@v1`)

Versioned client for the Registro.br availability service ISAVAIL
(Protocolo-ISAVAILv2, `avail.registro.br`, UDP port 43). Implements the
provider contract `IsavailProvider` in `@domainhunter/providers` (RNF-015,
RNF-022). Per the product brief, ISAVAIL is the only authorized source of
domain availability (RNF-020).

## Protocol

- UDP/43: send a single query packet to `avail.registro.br`, read a single
  reply packet.
- Wire query: `<version> <cookie> <lang> <qid> <fqdn> [<suggest>]`.
- Cookie handshake: the first query uses the placeholder cookie; if the
  server replies `CK <cookie> <qid>`, the client stores the cookie and
  re-sends the query once (official client behaviour).
- Replies are encoded ISO-8859-1; the parser works on Latin-1 text.
- Official status codes 0-9 are normalized into `IsavailRecord.status`.

## Versioning (RNF-016, RNF-023)

- Every normalized record carries `sourceVersion: "isavail-client@v1"`
  (constant `ISAVAIL_CLIENT_VERSION`), recorded on `domain_events` so
  historical availability decisions can be reproduced with the exact
  parser.
- The protocol (`protocol.ts`) and transport (`transport.ts`) are
  independent modules paired through the client factory (`client.ts`).
  Bump the version constant when query protocol or parsing rules change
  and keep the old parser/fixtures under their own version.

## Normalized record

`IsavailRecord` (see `isavail-provider.ts`) extracts:

| ISAVAIL reply | Normalized field |
|---|---|
| `ST <code> <qid>` | `statusCode` / `status` (canonical name) |
| — | `available` (true only for statuses 0/1) |
| fqdn (and ACE form) | `fqdn` / `fqdnAce` |
| status 2 | `expirationDate`, `publicationStatus`, `nameServers` |
| statuses 1/7/9 | `tickets[]` |
| statuses 6/7/9 | `releaseBeginAt`, `releaseEndAt` |
| status 9 | `acceptingNewTicketsUntil` |
| statuses 3/4/8 | `message` |
| full reply | `raw` (preserved for audit, RNF-007) |

`available` is `true` only when the service authoritatively reported the
name can be registered (status 0 or 1). Errors, timeouts, and rate-limited
replies never imply availability (RNF-001, RNF-020).

## Technical errors

`IsavailError` with an identifiable `code` (product brief §23). These are
technical failures, never domain verdicts (RNF-001, RNF-020).

| Code | When |
|---|---|
| `ISAVAIL_TIMEOUT` | No UDP reply within the configured timeout |
| `RATE_LIMIT` | Service replies `Query rate limit exceeded` |
| `PARSER_ERROR` | Reply has no recognizable `ST`/`CK` line or status code |
| `SOURCE_UNAVAILABLE` | Socket error / DNS failure |

## Usage

```ts
import { createIsavailClientV1 } from "@domainhunter/providers";

const client = createIsavailClientV1({ timeoutMs: 5_000 });
const record = await client.check("domainhunter.com.br");
// record.available, record.statusCode, record.raw
```

## Testing

- `protocol.test.ts` — contract tests against real captured fixtures under
  `fixtures/` (available, available-with-ticket, available-ace, registered,
  reserved, release-waiting, competitive-release, invalid-query, rate-limit,
  cookie-handshake, invalid).
- `transport.test.ts` — drives the real UDP code path against a local
  server to cover round-trip and timeout behaviour.
- `client.test.ts` — cookie handshake, availability mapping, and error
  surfacing through the versioned client.
