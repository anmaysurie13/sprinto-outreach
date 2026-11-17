"use client";
import { useCallback, useEffect, useState } from "react";

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: string[] };
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Request failed (${res.status})`), { issues: data.issues });
  return data as T;
}

/** GET with loading/error state, optional polling. `reload()` re-fetches. */
export function useApi<T>(url: string | null, pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    api<T>(url)
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoadedUrl(url);
      });
    return () => {
      cancelled = true;
    };
  }, [url, tick]);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener("pipeline:changed", bump);
    return () => window.removeEventListener("pipeline:changed", bump);
  }, []);

  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(() => setTick((n) => n + 1), pollMs);
    return () => clearInterval(t);
  }, [pollMs]);

  const reload = useCallback(async () => setTick((n) => n + 1), []);
  return { data, error, loading: url !== null && loadedUrl !== url, reload };
}

export interface StepResult {
  companyId: number;
  status: string;
  stage: string;
  done: boolean;
  busy?: boolean;
  message: string;
}

/**
 * Drive one company's persisted workflow, one server request per step, until it reaches a terminal status.
 * The loop is bounded; progress lives in the database so it can always be resumed.
 */
export async function runCompany(id: number, onUpdate: (r: StepResult | { error: string }) => void): Promise<void> {
  for (let i = 0; i < 25; i++) {
    try {
      const r = await api<StepResult>(`/api/companies/${id}/step`, { method: "POST" });
      onUpdate(r);
      if (r.done) return;
      if (r.busy) await new Promise((res) => setTimeout(res, 2500));
    } catch (e) {
      onUpdate({ error: e instanceof Error ? e.message : "Step failed" });
      return;
    }
  }
}

export async function runMany(ids: number[], onUpdate: (id: number, r: StepResult | { error: string }) => void, concurrency = 2) {
  const queue = [...ids];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift()!;
        await runCompany(id, (r) => onUpdate(id, r));
      }
    }),
  );
}

export const fmtDuration = (ms: number | null | undefined) =>
  ms == null ? "—" : ms < 60_000 ? `${(ms / 1000).toFixed(0)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;

export const fmtTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
