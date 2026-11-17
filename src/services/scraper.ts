import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import { lookup } from "node:dns/promises";
import net from "node:net";

const BOT_TOKEN = "SprintoOutreachBot";
const UA = `${BOT_TOKEN}/1.0 (educational prototype; respects robots.txt)`;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
export const MAX_TEXT_CHARS = 12_000;
const MIN_TEXT_CHARS = 200;

export type ScrapeErrorCode =
  | "BAD_URL"
  | "PRIVATE_HOST"
  | "ROBOTS_DISALLOWED"
  | "BLOCKED" // login wall, CAPTCHA, bot challenge, 401/403/429 — never bypassed
  | "HTTP_ERROR"
  | "NOT_HTML"
  | "EMPTY_CONTENT" // likely JS-rendered; browser rendering is not supported on Vercel
  | "REDIRECT_OFFSITE"
  | "TIMEOUT"
  | "NETWORK";

export interface ScrapeResult {
  ok: boolean;
  url: string;
  finalUrl?: string;
  status?: number;
  text?: string;
  links?: string[];
  error?: string;
  code?: ScrapeErrorCode;
}

/* ---------- SSRF guard ---------- */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new ScrapeError("PRIVATE_HOST", "Refusing to fetch private/internal address");
    return;
  }
  const addrs = await lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))
    throw new ScrapeError("PRIVATE_HOST", "Host resolves to a private/internal address");
}

class ScrapeError extends Error {
  constructor(public code: ScrapeErrorCode, message: string) {
    super(message);
  }
}

const stripWww = (h: string) => h.replace(/^www\./, "");
const sameSite = (a: string, b: string) => {
  const x = stripWww(a), y = stripWww(b);
  return x === y || x.endsWith("." + y) || y.endsWith("." + x);
};

/* ---------- robots.txt (cached per origin for the life of the instance) ---------- */
const robotsCache = new Map<string, { at: number; allow: (u: string) => boolean }>();

async function robotsAllows(url: URL): Promise<boolean> {
  const cached = robotsCache.get(url.origin);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.allow(url.href);
  let allow: (u: string) => boolean = () => true;
  try {
    const res = await fetch(`${url.origin}/robots.txt`, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(5_000),
      redirect: "follow",
    });
    if (res.status >= 500) allow = () => false; // RFC 9309: server errors => assume disallowed
    else if (res.ok) {
      const txt = (await res.text()).slice(0, 200_000);
      const robots = robotsParser(`${url.origin}/robots.txt`, txt);
      allow = (u) => robots.isAllowed(u, BOT_TOKEN) !== false;
    } // 4xx => no robots file => allowed
  } catch {
    allow = () => true; // unreachable robots.txt: the page fetch will surface network errors itself
  }
  robotsCache.set(url.origin, { at: Date.now(), allow });
  return allow(url.href);
}

/* ---------- HTML cleaning ---------- */
const BLOCK_SIGNALS = /captcha|cf-chl|cf-browser-verification|just a moment\.\.\.|attention required|access denied|verify you are (a )?human|enable javascript and cookies/i;

export function cleanHtml(html: string, pageUrl: string): { text: string; links: string[]; blocked: boolean } {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);

  // Collect same-site links BEFORE stripping navigation (nav is where /security, /careers live).
  const links = new Set<string>();
  $("a[href]").each((_, el) => {
    try {
      const u = new URL($(el).attr("href")!, base);
      if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, base.hostname)) return;
      if (/\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|css|js|xml)$/i.test(u.pathname)) return;
      u.hash = "";
      u.search = "";
      links.add(u.href.replace(/\/$/, ""));
    } catch {
      /* ignore malformed href */
    }
  });

  const title = $("title").first().text().trim();
  const metaDesc = $('meta[name="description"]').attr("content")?.trim() ?? "";
  $("script,style,noscript,svg,iframe,canvas,nav,footer,aside,form,[role=navigation],[role=contentinfo],[aria-hidden=true]").remove();
  $("p,div,li,h1,h2,h3,h4,h5,h6,section,article,tr,td,th,br,blockquote").each((_, el) => {
    $(el).append("\n");
  });

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const raw of [title, metaDesc, ...$("body").text().split("\n")]) {
    const line = raw.replace(/\s+/g, " ").trim();
    const key = line.toLowerCase();
    if (line.length < 3 || seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
  }
  let text = lines.join("\n");
  const blocked = text.length < 1500 && BLOCK_SIGNALS.test(html.slice(0, 5000));
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
  return { text, links: [...links].slice(0, 80), blocked };
}

/* ---------- fetch ---------- */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}

/** Fetch one public page politely. Never throws — failures come back as {ok:false, code}. */
export async function fetchPage(rawUrl: string): Promise<ScrapeResult> {
  try {
    let url = new URL(rawUrl);
    if (!/^https?:$/.test(url.protocol)) throw new ScrapeError("BAD_URL", "Only http(s) URLs are allowed");
    const origin = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url.hostname);
      if (!(await robotsAllows(url))) throw new ScrapeError("ROBOTS_DISALLOWED", "Disallowed by robots.txt");

      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "en" },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, url);
        if (!sameSite(next.hostname, origin.hostname))
          throw new ScrapeError("REDIRECT_OFFSITE", `Redirects to a different site (${next.hostname})`);
        url = next;
        continue;
      }
      if ([401, 403, 429].includes(res.status))
        throw new ScrapeError("BLOCKED", `Access restricted (HTTP ${res.status}); not bypassed`);
      if (!res.ok) throw new ScrapeError("HTTP_ERROR", `HTTP ${res.status}`);
      const ctype = res.headers.get("content-type") ?? "";
      if (!/html|xml/i.test(ctype)) throw new ScrapeError("NOT_HTML", `Unsupported content-type: ${ctype || "unknown"}`);

      const html = await readCapped(res);
      const { text, links, blocked } = cleanHtml(html, url.href);
      if (blocked) throw new ScrapeError("BLOCKED", "Bot challenge / CAPTCHA / login wall detected; not bypassed");
      if (text.length < MIN_TEXT_CHARS)
        throw new ScrapeError("EMPTY_CONTENT", "Page has too little readable text (possibly JavaScript-rendered)");
      return { ok: true, url: rawUrl, finalUrl: url.href, status: res.status, text, links };
    }
    throw new ScrapeError("HTTP_ERROR", "Too many redirects");
  } catch (e) {
    if (e instanceof ScrapeError) return { ok: false, url: rawUrl, error: e.message, code: e.code };
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, url: rawUrl, error: "Request timed out", code: "TIMEOUT" };
    return { ok: false, url: rawUrl, error: e instanceof Error ? e.message.slice(0, 200) : "Network error", code: "NETWORK" };
  }
}
