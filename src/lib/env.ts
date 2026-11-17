/** Server-only environment access. Values are never logged or returned to the client. */
export const ENV_NAMES = [
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_MODEL",
  "DATABASE_URL",
  "HUNTER_API_KEY",
  "RESEND_API_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "TEST_EMAIL",
] as const;

export class MissingEnvError extends Error {
  constructor(public readonly varName: string) {
    super(`Missing required environment variable: ${varName}`);
    this.name = "MissingEnvError";
  }
}

export function requireEnv(name: (typeof ENV_NAMES)[number]): string {
  const v = process.env[name]?.trim();
  if (!v) throw new MissingEnvError(name);
  return v;
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
}

export function testEmail(): string {
  return requireEnv("TEST_EMAIL").toLowerCase();
}

/** Presence only (never the value) — used by /api/health and the dashboard. */
export function envPresence(): Record<string, boolean> {
  return Object.fromEntries(ENV_NAMES.map((n) => [n, Boolean(process.env[n]?.trim())]));
}
