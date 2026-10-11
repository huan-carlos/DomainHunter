import nodemailer, { type Transporter } from "nodemailer";

/**
 * Email provider abstraction (LEX-27, technical plan §3/§9, product brief
 * §19, RNF-009).
 *
 * The interface is intentionally tiny so tests and the automations worker can
 * inject fakes or the real SMTP implementation without changing the
 * notification service. Credentials are never hard-coded: the SMTP provider
 * reads them from environment variables (RNF-009).
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

/** SMTP configuration read from environment variables (RNF-009). */
export interface SmtpEmailConfig {
  host: string;
  port: number;
  /** Defaults to false (STARTTLS on port 587); set for implicit TLS on 465. */
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

export const SMTP_ENV_KEYS = [
  "DOMAINHUNTER_SMTP_HOST",
  "DOMAINHUNTER_SMTP_PORT",
  "DOMAINHUNTER_SMTP_USER",
  "DOMAINHUNTER_SMTP_PASS",
  "DOMAINHUNTER_SMTP_SECURE",
  "DOMAINHUNTER_SMTP_FROM",
] as const;

/**
 * Read the SMTP configuration from an environment object. Returns null when
 * the host is missing (email disabled → dashboard-only mode).
 */
export function smtpConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SmtpEmailConfig | null {
  const host = env.DOMAINHUNTER_SMTP_HOST;
  if (!host) return null;
  const port = Number(env.DOMAINHUNTER_SMTP_PORT ?? "587");
  const secure = (env.DOMAINHUNTER_SMTP_SECURE ?? "false").toLowerCase() === "true";
  const user = env.DOMAINHUNTER_SMTP_USER;
  const pass = env.DOMAINHUNTER_SMTP_PASS;
  return {
    host,
    port,
    secure,
    ...(user != null && user.length > 0 ? { user } : {}),
    ...(pass != null && pass.length > 0 ? { pass } : {}),
    from: env.DOMAINHUNTER_SMTP_FROM ?? "domainhunter@domainhunter.local",
  };
}

/**
 * SMTP provider backed by nodemailer. `send` throws on delivery failure so
 * the caller can mark the notification FAILED; it never crashes the process.
 */
export class SmtpEmailProvider implements EmailProvider {
  private readonly config: SmtpEmailConfig;
  private readonly transporter: Transporter;

  constructor(config: SmtpEmailConfig) {
    this.config = config;
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user != null && config.pass != null
        ? { auth: { user: config.user, pass: config.pass } }
        : {}),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html != null ? { html: message.html } : {}),
    });
  }
}
