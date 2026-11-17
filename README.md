# Sprinto Outreach — Cold Outreach at Scale (Mesa Sprinto AI Build 2)

Educational prototype. Turns a list of company domains into a qualified prospect, a verified decision-maker and an evidence-backed personalised cold email — then sends it **only to your own test inbox**.

> Never sends to prospects. The Gmail recipient is hard-wired to `TEST_EMAIL`; the draft still greets the real discovered person by name.

## Seven-stage workflow

| # | Stage | Service | Key safeguards |
|---|---|---|---|
| 1 | Scrape website | `scraper` | Domain validation/normalisation/dedupe, robots.txt, SSRF block (private IPs), 12s timeout, 1.5 MB cap, CAPTCHA/login-wall detection (never bypassed), nav/footer/script removal, line de-duplication, page text cached in `evidence` |
| 2 | Extract structured data | `extractor` + `gemini` | Gemini JSON validated with Zod; unknown → `null`; source URLs attached by code (not the model) |
| 3 | Qualify vs ICP + agent loop | `qualifier`, `research-agent` | Deterministic named-field criteria (B2B SaaS / growth / compliance need); Gemini only gives a second opinion and can veto; funding alone never qualifies; ≤ 4 extra pages (`/security`, `/trust`, `/careers`, `/customers`, `/pricing`…), discovered links preferred; stops at once if disqualified; unresolved → `MANUAL_REVIEW` |
| 4 | Find decision-maker | `hunter` | One Domain Search per company; ranking CISO/Head of Security → Compliance/GRC → CTO/VP Eng → Founder/CEO; requires real name, relevant title, email on company domain, Hunter `verification.status = valid`; otherwise `MANUAL_REVIEW` (never guessed) |
| 5 | Two pain points | `pain-points` | Exactly 2, distinct themes, "verified" vs "hypothesis" labelled, mapped only to an approved Sprinto capability list |
| 6 | Draft email | `email-generator` | 120–160 words, greets contact by first name, hook must quote stored page text verbatim, regex claim-checker rejects unsupported funding / numbers / hiring / certification claims; one human edit flow + one AI revision |
| 7 | Test send (Resend, or Gmail API) | `gmail`, `send` | Recipient must equal `TEST_EMAIL`; MIME builder has no CC/BCC; explicit confirmation per send; atomic DB claim prevents duplicates; no automatic retries; logs message ID; status shown as **API_ACCEPTED** (not "delivered") |

Statuses: `PENDING`, `RESEARCHING`, `QUALIFIED`, `DISQUALIFIED`, `MANUAL_REVIEW`, `DRAFT_READY`, `SENT`, `FAILED`.

## Architecture

- **Next.js 16 App Router + TypeScript**, Tailwind v4, shadcn-style primitives (`src/components/ui.tsx`), Lucide icons, Inter.
- **Server-only integrations** under `src/services/*` called from route handlers in `src/app/api/*`. No secrets reach the browser.
- **Resumable workflow**: `orchestrator.stepCompany()` runs exactly one stage per request and persists state in `runs` (with a row lock). The browser drives `POST /api/companies/:id/step` until a terminal status, so no single Vercel request does long work; any interrupted run resumes from the Pipeline page.
- **Neon Postgres** via `@neondatabase/serverless`. Tables: `companies`, `evidence`, `contacts`, `outreach`, `runs`, plus `events` (audit log for the Activity page). Unique constraints: `companies.domain`, `evidence(company_id, source_url)`, `contacts(company_id, email)`, `outreach(company_id, campaign)`, `runs.company_id`.
- **No login (by design)**: the dashboard is open. To limit abuse of a public URL, new companies are capped at 30 per rolling 24 hours and 25 per batch, emails can only ever go to `TEST_EMAIL`, and contact emails are masked in API responses.
- **Cost controls**: ≤ 25 domains/batch; per company at most ~13 Gemini calls (extraction ≤5, qualification gate only when all criteria have evidence, 1 pain-point, 1 draft + 1 repair, 1 optional revision), 1 Hunter call, 0 automatic Gmail retries.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values — never commit
npm run migrate              # creates tables in Neon
npm run dev
```

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` **or** `OPENROUTER_API_KEY`, `GEMINI_MODEL` | Google AI Studio key, or an OpenRouter key that calls the same Gemini model (`google/<GEMINI_MODEL>`); model defaults to `gemini-2.5-flash` |
| `DATABASE_URL` | Neon pooled connection string |
| `HUNTER_API_KEY` | Hunter.io Domain Search |
| `RESEND_API_KEY` *(used when set)* | Test sending via Resend. Without a verified domain Resend only delivers to the account owner's address, so `TEST_EMAIL` must be that address. Sends carry an idempotency key. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Alternative: Gmail API OAuth2, scope `gmail.send` only (used when no Resend key) |
| `TEST_EMAIL` | The only address the app can send to |

## Scripts

`npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run migrate`

## Tests (`tests/`, Vitest, mocked — no network)

1 invalid domain · 2 non-SaaS → DISQUALIFIED · 3 qualified SaaS (+ veto, funding-alone) · 4 insufficient evidence → loop picks `/security` · 5 limit of 4 pages → MANUAL_REVIEW · 6 Hunter with no verified contact · 7 unsupported hook / invented claims rejected · 8 wrong Gmail recipient blocked before any network call · 9 duplicate & concurrent sends blocked · plus SSRF and HTML-cleaning checks. Test 10 (real end-to-end) needs real credentials and an explicitly approved send.

## Limitations

- JavaScript-only websites are not rendered (no headless browser on Vercel); they are flagged `EMPTY_CONTENT` → manual review.
- Hunter data can be stale; "valid" verification is required but not proof of current employment.
- The claim checker is pattern-based: it catches funding, numbers, hiring and certification claims, not every possible fabrication. Human review stays required.
- `API_ACCEPTED` means Gmail accepted the request; inbox delivery must be checked manually.
- DNS-rebinding between the SSRF check and the fetch is not fully prevented.
- Anyone with the URL can add companies (within the daily cap) and trigger test sends to your own inbox; add authentication before any real use.
- Faculty targets (under 2 min/company, under 20% rewrites) are goals, not measured results.

## Test results (2026-11-17)

| # | Test | How | Result |
|---|---|---|---|
| 1–9 | Invalid domain, non-SaaS, qualified SaaS, research loop, research limit, no verified contact, unsupported hook, wrong recipient, duplicate send | `npm test` (Vitest, mocked) | **45/45 pass** |
| 1 | Invalid domain via real API | `POST /api/companies` with `not_a_domain` | Rejected: "Missing top-level domain" |
| 10 | Real end-to-end (Gemini via OpenRouter, Neon, Hunter.io) on one public B2B SaaS domain | Dashboard API, step-by-step | Scrape → extract → qualify → 1 research page (`/about`) → **QUALIFIED** → Hunter Tier-1 contact (Head of Security, `valid`) → 2 pain points (1 verified, 1 hypothesis) → 130-word draft with verbatim hook → **DRAFT_READY in 36 s** |
| 10b | Real test send (Resend → own test inbox) | Requires an explicit click in the UI | Not yet run — pending approval |

Not verified yet: inbox delivery, Vercel production run, Gmail OAuth path (Resend is used instead).
