import type { z } from "zod";
import { geminiModel, MissingEnvError } from "@/lib/env";

const TIMEOUT_MS = 45_000;
const MAX_HTTP_RETRIES = 2;

export class GeminiError extends Error {
  constructor(message: string, public retryable = false) {
    super(message);
    this.name = "GeminiError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gemini can be reached two ways:
 *  - directly via Google AI Studio (GEMINI_API_KEY, preferred when set), or
 *  - via OpenRouter (OPENROUTER_API_KEY), calling the same Gemini model as "google/<GEMINI_MODEL>".
 */
interface Provider {
  name: string;
  key: string;
  url: string;
  headers: Record<string, string>;
  body(system: string, prompt: string, max: number): string;
  text(json: unknown): { text?: string; reason?: string };
}

function provider(): Provider {
  const gemini = process.env.GEMINI_API_KEY?.trim();
  if (gemini) {
    return {
      name: "Gemini",
      key: gemini,
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:generateContent`,
      headers: { "x-goog-api-key": gemini },
      body: (system, prompt, max) =>
        JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: max },
        }),
      text: (j) => {
        const json = j as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
        return {
          text: json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join(""),
          reason: json.promptFeedback?.blockReason ?? json.candidates?.[0]?.finishReason,
        };
      },
    };
  }
  const or = process.env.OPENROUTER_API_KEY?.trim();
  if (or) {
    const model = geminiModel().includes("/") ? geminiModel() : `google/${geminiModel()}`;
    return {
      name: "OpenRouter",
      key: or,
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { authorization: `Bearer ${or}`, "x-title": "Sprinto Outreach Prototype" },
      body: (system, prompt, max) =>
        JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: max,
        }),
      text: (j) => {
        const json = j as { choices?: { message?: { content?: string }; finish_reason?: string }[]; error?: { message?: string } };
        return { text: json.choices?.[0]?.message?.content, reason: json.error?.message ?? json.choices?.[0]?.finish_reason };
      },
    };
  }
  throw new MissingEnvError("GEMINI_API_KEY (or OPENROUTER_API_KEY)");
}

async function callGemini(system: string, prompt: string, maxOutputTokens: number): Promise<string> {
  const p = provider();
  const body = p.body(system, prompt, maxOutputTokens);
  let lastErr = "";
  for (let attempt = 0; attempt <= MAX_HTTP_RETRIES; attempt++) {
    try {
      const res = await fetch(p.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...p.headers },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = `${p.name} HTTP ${res.status}`;
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const t = (await res.text()).slice(0, 300).replaceAll(p.key, "[redacted]");
        throw new GeminiError(`${p.name} HTTP ${res.status}: ${t}`);
      }
      const { text, reason } = p.text(await res.json());
      if (!text) throw new GeminiError(`${p.name} returned no content (${reason ?? "unknown"})`);
      return text;
    } catch (e) {
      if (e instanceof GeminiError) throw e;
      lastErr = e instanceof Error ? `${e.name}: ${e.message}` : "network error";
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new GeminiError(`${p.name} unavailable after retries (${lastErr})`, true);
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  return JSON.parse(cleaned);
}

/**
 * Call the model expecting JSON, validate with Zod. One repair attempt on invalid output
 * (bounded cost: at most 2 model calls per invocation, each with up to 2 HTTP retries).
 */
export async function geminiJson<T>(opts: {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
}): Promise<T> {
  const max = opts.maxOutputTokens ?? 4096;
  let prompt = opts.prompt;
  let lastIssue = "";
  for (let i = 0; i < 2; i++) {
    const text = await callGemini(opts.system, prompt, max);
    try {
      const parsed = opts.schema.safeParse(parseJson(text));
      if (parsed.success) return parsed.data;
      lastIssue = parsed.error.issues.slice(0, 5).map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
    } catch {
      lastIssue = "response was not valid JSON";
    }
    prompt = `${opts.prompt}\n\nYour previous reply was rejected: ${lastIssue}. Return ONLY corrected JSON that satisfies the schema.`;
  }
  throw new GeminiError(`Model output failed validation: ${lastIssue}`);
}
