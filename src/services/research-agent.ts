import { MAX_EXTRA_PAGES, type Verdict } from "@/lib/types";
import type { MissingEvidence } from "./qualifier";

/** Preferred paths per missing evidence type, most relevant first. */
export const PAGE_PRIORITY: Record<MissingEvidence, string[]> = {
  saas_classification: ["/product", "/platform", "/pricing", "/solutions", "/about"],
  compliance_need: ["/security", "/trust", "/trust-center", "/compliance", "/customers", "/enterprise"],
  growth_stage: ["/about", "/careers", "/customers", "/jobs", "/pricing", "/company"],
};

const norm = (u: string) => u.replace(/\/$/, "").replace(/^http:/, "https:").replace("://www.", "://").toLowerCase();

export interface NextPage {
  url: string;
  path: string;
  reason: string;
  discovered: boolean;
}

/**
 * Choose the most relevant NEXT page for the missing evidence.
 * Prefers links actually found on the site over guessed paths; never repeats a URL.
 */
export function chooseNextPage(opts: {
  domain: string;
  links: string[];
  tried: string[];
  missing: MissingEvidence[];
}): NextPage | null {
  const tried = new Set(opts.tried.map(norm));
  const links = opts.links.filter((l) => !tried.has(norm(l)));

  for (const need of opts.missing) {
    const wanted = PAGE_PRIORITY[need];
    for (const path of wanted) {
      const hit = links.find((l) => {
        try {
          const p = new URL(l).pathname.replace(/\/$/, "").toLowerCase();
          return p === path || p.startsWith(path + "/") || p.startsWith(path + "-");
        } catch {
          return false;
        }
      });
      if (hit) return { url: hit, path, reason: `Missing ${need}; found ${path} on the site`, discovered: true };
    }
  }
  for (const need of opts.missing) {
    for (const path of PAGE_PRIORITY[need]) {
      const url = `https://${opts.domain}${path}`;
      if (!tried.has(norm(url))) return { url, path, reason: `Missing ${need}; trying ${path}`, discovered: false };
    }
  }
  return null;
}

export type LoopAction =
  | { action: "stop_disqualified"; reason: string }
  | { action: "proceed_qualified"; reason: string }
  | { action: "fetch"; next: NextPage; reason: string }
  | { action: "manual_review"; reason: string };

/** Decide what the research loop does after a verdict. Enforces the 4-extra-page limit. */
export function decideNext(opts: {
  verdict: Verdict;
  pagesFetched: number;
  domain: string;
  links: string[];
  tried: string[];
  missing: MissingEvidence[];
}): LoopAction {
  const { verdict, pagesFetched } = opts;
  if (verdict.decision === "DISQUALIFIED") return { action: "stop_disqualified", reason: verdict.reasoning };
  if (verdict.decision === "QUALIFIED") return { action: "proceed_qualified", reason: verdict.reasoning };
  if (pagesFetched >= MAX_EXTRA_PAGES)
    return {
      action: "manual_review",
      reason: `Research limit reached (${MAX_EXTRA_PAGES} additional pages) with unresolved evidence: ${opts.missing.join(", ") || "reviewer confirmation"}.`,
    };
  const next = chooseNextPage(opts);
  if (!next) return { action: "manual_review", reason: "No further relevant pages to fetch; evidence remains insufficient." };
  return { action: "fetch", next, reason: next.reason };
}
