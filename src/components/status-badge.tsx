import { Badge } from "@/components/ui";

const TONES: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = {
  PENDING: "neutral",
  RESEARCHING: "info",
  QUALIFIED: "ok",
  DISQUALIFIED: "bad",
  MANUAL_REVIEW: "warn",
  DRAFT_READY: "ok",
  SENT: "ok",
  FAILED: "bad",
  NEEDS_MORE_INFO: "warn",
  met: "ok",
  unmet: "bad",
  unknown: "neutral",
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted">—</span>;
  return <Badge tone={TONES[value] ?? "neutral"}>{value.replace(/_/g, " ")}</Badge>;
}

export const STAGE_LABELS: Record<string, string> = {
  scrape: "1 · Scrape",
  extract: "2 · Extract",
  qualify: "3 · Qualify",
  research: "3 · Research loop",
  contact: "4 · Contact",
  painpoints: "5 · Pain points",
  draft: "6 · Draft",
  done: "Done",
};
