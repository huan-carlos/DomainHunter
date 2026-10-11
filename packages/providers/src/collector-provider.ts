export interface CollectedData {
  domain: string;
  sources: string[];
  whois: unknown;
  rdap: unknown;
  availability: unknown;
  /** UTC ISO-8601 instant when the collection happened. */
  collectedAt: string;
}

export interface CollectorProvider {
  collect(domain: string): Promise<CollectedData>;
}
