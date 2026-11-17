export type DomainResult = { ok: true; domain: string } | { ok: false; reason: string };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Validate + normalise user input to a bare registrable-looking hostname. */
export function normalizeDomain(input: string): DomainResult {
  let s = input.trim().toLowerCase();
  if (!s) return { ok: false, reason: "Empty input" };
  if (/\s/.test(s)) return { ok: false, reason: "Contains whitespace" };
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
  s = s.split(/[/?#]/)[0]; // strip path/query/fragment
  if (s.includes("@")) return { ok: false, reason: "Looks like an email address, not a domain" };
  s = s.replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (!s) return { ok: false, reason: "Empty domain" };
  if (s.length > 253) return { ok: false, reason: "Domain too long" };
  if (s === "localhost" || s.endsWith(".localhost") || s.endsWith(".local") || s.endsWith(".internal"))
    return { ok: false, reason: "Local/internal hostnames are not allowed" };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(":")) return { ok: false, reason: "IP addresses are not allowed" };
  const labels = s.split(".");
  if (labels.length < 2) return { ok: false, reason: "Missing top-level domain (e.g. .com)" };
  if (!labels.every((l) => LABEL.test(l))) return { ok: false, reason: "Invalid characters in domain" };
  const tld = labels[labels.length - 1];
  if (!/^[a-z]{2,24}$/.test(tld)) return { ok: false, reason: "Invalid top-level domain" };
  return { ok: true, domain: s };
}

export function parseDomainList(raw: string): { domains: string[]; rejected: { input: string; reason: string }[] } {
  const seen = new Set<string>();
  const domains: string[] = [];
  const rejected: { input: string; reason: string }[] = [];
  for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
    const r = normalizeDomain(part);
    if (!r.ok) rejected.push({ input: part, reason: r.reason });
    else if (!seen.has(r.domain)) {
      seen.add(r.domain);
      domains.push(r.domain);
    }
  }
  return { domains, rejected };
}
