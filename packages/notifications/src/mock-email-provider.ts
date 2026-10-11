/**
 * In-memory email provider — a mock SMTP for tests and local runs. It records
 * every sent message and can be configured to fail (or fail a fixed number of
 * times) to exercise the notification retry/FAILED path without a real SMTP
 * server (RNF-017).
 */
import type { EmailMessage, EmailProvider } from "./email-provider.ts";

export interface InMemoryEmailProviderOptions {
  /** Messages this many sends before succeeding (limited retry test). */
  failCount?: number;
  /** Always fail every send. */
  failAlways?: boolean;
}

export class InMemoryEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];
  readonly failures: Error[] = [];
  private readonly failCount: number;
  private readonly failAlways: boolean;
  private attempts = 0;

  constructor(options: InMemoryEmailProviderOptions = {}) {
    this.failCount = options.failCount ?? 0;
    this.failAlways = options.failAlways ?? false;
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.failAlways || this.attempts < this.failCount) {
      this.attempts += 1;
      const error = new Error("SMTP_522_INJECTION_FAILURE");
      this.failures.push(error);
      throw error;
    }
    this.sent.push(message);
  }
}
