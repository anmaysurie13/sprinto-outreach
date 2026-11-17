import { NextResponse } from "next/server";
import { MissingEnvError } from "@/lib/env";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });

/** Wrap a route handler: map known errors to safe messages, never leak stack traces or secrets. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MissingEnvError) return json({ error: e.message }, 503);
    const status = (e as { httpStatus?: number }).httpStatus;
    const message = e instanceof Error ? e.message : "Unexpected error";
    if (status) return json({ error: message }, status);
    console.error("API error:", message);
    return json({ error: message.slice(0, 300) }, 500);
  }
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { httpStatus: 400 });
  }
}

export function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error("Invalid company id"), { httpStatus: 400 });
  return id;
}

export function maskEmail(email: string): string {
  const [u, d] = email.split("@");
  return `${u.slice(0, 2)}${"*".repeat(Math.max(u.length - 2, 1))}@${d}`;
}
