/** Faculty-provided Build Readiness content. Business checks only — not technical validation rules. */
export interface Check {
  n: string;
  q: string;
  verdict: "YES" | "PARTIAL" | "YES, with limitations";
  detail: string;
}

export const CATEGORIES: { name: string; rule: string; tone: "bad" | "warn" | "info"; checks: Check[] }[] = [
  {
    name: "Kill Switches",
    rule: "Any NO: Don't Build",
    tone: "bad",
    checks: [
      { n: "01", q: "Problem real?", verdict: "YES", detail: "15–20 minutes/company; quality deteriorates with repeated manual work." },
      { n: "02", q: "Workflow repeated?", verdict: "YES", detail: "Same research, qualification, contact and drafting workflow every week." },
      { n: "03", q: "Input available?", verdict: "YES, with limitations", detail: "Public company websites and Hunter.io. Missing information must be flagged, not fabricated." },
    ],
  },
  {
    name: "Sizing",
    rule: "Any NO: Build Smaller",
    tone: "info",
    checks: [
      { n: "04", q: "Output valuable?", verdict: "YES", detail: "Qualified prospect, relevant contact and actionable personalised email." },
      { n: "05", q: "Impact measurable?", verdict: "YES", detail: "Track processing time, contact accuracy, email rewrite rate, qualification quality and sending outcomes." },
      { n: "06", q: "ROI worth it?", verdict: "YES", detail: "Faculty example: YES. Potential time savings and improved outbound performance justify a prototype. Actual ROI remains unverified until testing." },
    ],
  },
  {
    name: "Boundary",
    rule: "Any NO: Put a Human Here",
    tone: "warn",
    checks: [
      { n: "07", q: "Failure risk OK?", verdict: "PARTIAL", detail: "Stale contact data and incorrect claims are possible. Use verified evidence and test-only Gmail delivery." },
      { n: "08", q: "Judgment protected?", verdict: "PARTIAL", detail: "AI applies defined ICP criteria; Growth Lead reviews uncertain cases and approves any future real-world outreach." },
      { n: "09", q: "Owner clear?", verdict: "YES", detail: "Sprinto Growth Lead owns ICP, output quality, review and eventual real-world sending decisions." },
    ],
  },
];

export const DECISIONS = [
  { k: "Outcome", v: "Reduce time to draft from 15–20 minutes to under 2 minutes/company." },
  { k: "Baseline", v: "8–15 companies/week; manual research and writing." },
  { k: "Workflow change", v: "Growth Lead becomes reviewer rather than researcher." },
  { k: "Measurement", v: "Time/company under 2 minutes; email rewrites under 20%; conversion holds or improves when measurable." },
  { k: "Kill criteria", v: "Stop if over 50% of drafts require rewriting, workflow takes longer than manual, or contact accuracy falls below 60%." },
];
