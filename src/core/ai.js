// Ollama client + campaign generation. Talks to the user's self-hosted Ollama
// (behind Caddy, Bearer auth, self-signed cert on the LAN). Uses node:https so
// we can allow the self-signed LAN cert without extra dependencies.
import https from "node:https";
import http from "node:http";

function postJson(urlStr, headers, bodyObj, insecure) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const body = Buffer.from(JSON.stringify(bodyObj));
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: { ...headers, "Content-Length": body.length },
        rejectUnauthorized: !insecure,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Ollama ${res.statusCode} ${res.statusMessage}: ${data.slice(0, 200)}`));
          } else resolve(data);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export function makeClient({ baseUrl, model, password, insecureTLS = true }) {
  const url = baseUrl.replace(/\/+$/, "");
  const headers = { "Content-Type": "application/json" };
  if (password) headers.Authorization = `Bearer ${password}`;
  const insecure = url.startsWith("https:") && insecureTLS;
  async function chat(messages, { format = "json", temperature = 0.6 } = {}) {
    const raw = await postJson(`${url}/api/chat`, headers, { model, messages, stream: false, format, options: { temperature } }, insecure);
    const data = JSON.parse(raw);
    return data.message?.content ?? "";
  }
  return { chat, model, url };
}

function safeParse(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}

export function buildBriefText(brief) {
  return [
    `Idea: ${brief.idea || "(none)"}`,
    `CEFR level: ${brief.cefrLevel || "A1"}`,
    `Target language to teach: ${brief.targetLanguage || "(you choose, appropriate to the level)"}`,
    `Student interests: ${brief.interests || "(general)"}`,
    `Length: ${brief.length || "one-shot (~25 min)"}`,
    `L1 (native language) for hints: ${brief.l1 || "Japanese (kana/kanji + romaji)"}`,
  ].join("\n");
}

const SPEC_SHAPE = `Return ONLY a JSON object with this exact shape:
{
  "title": string,
  "cefrLevel": "A1"|"A2"|"B1"|"B2"|"C1"|"C2",
  "estimatedMinutes": number,
  "premise": string,
  "endingSummary": string,
  "sections": [
    {
      "title": string,
      "targetLanguage": [ { "text": "english word or phrase", "type": "vocab"|"phrase"|"grammar", "l1": "Japanese translation with romaji in parentheses" } ],
      "scenes": [
        {
          "text": "1-3 short sentences of scene narration in simple English at the CEFR level",
          "choices": [
            { "label": "short action", "write": { "prompt": "what the student writes in English", "expect": 2 }, "dc": 10 },
            { "label": "another short action" }
          ]
        }
      ]
    }
  ],
  "spells": [ { "name": string, "flavor": string, "effect": "escape"|"foresight"|"charm" } ]
}`;

const RULES = `Rules:
- Exactly 2 sections, each with 2-3 scenes.
- Each section lists 5-7 target-language items, each with a Japanese l1 hint (kana/kanji + romaji).
- Include at least one "write" choice per section (a short writing task that uses the target language).
- Include exactly ONE choice somewhere with a "trap": { "clue": "a subtle hint", "text": "what goes wrong", "fixPrompt": "what to write to fix it" } -- a hidden consequence the student could not have known about.
- Keep ALL English at the stated CEFR level (simple words and short sentences for A1/A2).
- Output JSON only. No explanation, no markdown.`;

// Grade a student's written answer against the section's target-language bank.
// Schema-locked output: the model MUST emit JSON in our shape, which we then
// normalize to the same fields the engine + UI already consume from the stub.
const GRADE_SHAPE = `{
  "qualityScore": number from 0 to 1,
  "distinctUsed": ["target item text"],
  "mistakes": ["short, kind note in plain English"],
  "corrected": "a cleaner version of the student's sentence",
  "intent": "one short sentence describing what they were trying to say"
}`;

export async function aiGrade(client, text, bank, opts = {}) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    return { stub: false, qualityScore: 0, distinctUsed: [], distinctCount: 0, mistakes: ["Write a sentence to answer."], corrected: "", rollBonus: 0, isHighQuality: false };
  }
  const maxBonus = opts.maxGrammarBonus ?? 4;
  const cefr = opts.cefrLevel || "A1";
  // Intentionally NOT passing l1Hint — the grader judges English only, and
  // showing it the Japanese translations makes a 7B model want to emit Japanese.
  const bankLines = (bank || [])
    .map((b) => `- "${b.text}" (${b.type || "vocab"})`)
    .join("\n");

  const sys = `You are an English teacher grading a Japanese student's English. Your job:
- The student is LEARNING ENGLISH. The whole answer should be in English.
- The target-language items below are the ENGLISH words/phrases the student is practicing. The Japanese hint after each is just a translation reference for the student; the student MUST NOT use Japanese in their answer.
- All your "mistakes" notes must be about THEIR ENGLISH (grammar, spelling, word choice, missing punctuation, capital letters, missing words). NEVER suggest they use Japanese instead.
- Be strict about spelling and basic grammar even at A1. Be kind, but honest. Return ONLY JSON.`;

  const user = `Student CEFR level: ${cefr}.

Target English language for this section:
${bankLines || "(none specified)"}

Prompt the student was answering (in English):
"${opts.prompt || "(no prompt)"}"

What the student wrote (this should be ENGLISH):
"${cleanText}"

Grade their ENGLISH. Return JSON exactly in this shape:
${GRADE_SHAPE}

Scoring:
- 1.0 = clean English, all target items used correctly.
- 0.85 = mostly clean, one tiny issue (a missing capital, one minor word).
- 0.6–0.75 = understandable but with 2–3 real errors (spelling, missing article, missing politeness word).
- 0.3–0.5 = many errors (multiple misspellings, broken grammar, missing several target items the prompt asked for).
- 0.0–0.2 = blank, illegible, or not English.

Rules:
- distinctUsed: include a target item ONLY if the student wrote it correctly in their English answer. Use the exact "text" from the bank.
- mistakes: short, plain-English notes about THEIR ENGLISH. Examples: "Spelling: 'coffee' has two 'f' and two 'e'.", "Capital letter at start.", "Missing 'please' for politeness.", "Subject-verb: 'I want', not 'I wants'."
- ONLY flag mistakes that are actually in the student's text. Do NOT make up errors. If their sentence starts with a capital letter, do not say it's missing one. If they spelled a word correctly, do not say it's misspelled. Re-read their exact text before flagging anything.
- If the student's answer is clean and correct, return an empty mistakes array.
- corrected: a clean English rewrite of what they meant. Use capital letters and proper punctuation.
- NEVER write Japanese in any field. NEVER suggest the student use Japanese.
- Output JSON only. No markdown.`;

  let parsed;
  try {
    const content = await client.chat(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      { format: "json", temperature: 0.2 }
    );
    parsed = safeParse(content);
  } catch (e) {
    throw new Error(`grader call failed: ${e.message}`);
  }
  if (!parsed) throw new Error("grader returned unparseable JSON");

  const qualityScore = clamp01(Number(parsed.qualityScore) || 0);
  const bankTexts = new Set((bank || []).map((b) => b.text.toLowerCase()));
  const distinctUsed = Array.isArray(parsed.distinctUsed)
    ? [...new Set(parsed.distinctUsed.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean))]
        .filter((s) => bankTexts.has(s.toLowerCase()))
    : [];
  const mistakes = Array.isArray(parsed.mistakes) ? parsed.mistakes.filter((s) => typeof s === "string" && s.trim()).slice(0, 5) : [];
  const corrected = typeof parsed.corrected === "string" ? parsed.corrected.trim() : "";
  const rollBonus = Math.round(qualityScore * maxBonus);
  const isHighQuality = qualityScore >= 0.7 && mistakes.length <= 2;

  return { stub: false, qualityScore, distinctUsed, distinctCount: distinctUsed.length, mistakes, corrected, rollBonus, isHighQuality, intent: parsed.intent || "" };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

export async function generateStorySpec(client, brief) {
  const sys = "You design short, branching text-adventure campaigns that teach English to Japanese learners. You output only valid JSON.";
  const user = `${buildBriefText(brief)}\n\n${SPEC_SHAPE}\n\n${RULES}`;
  const content = await client.chat(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { format: "json", temperature: 0.7 }
  );
  const spec = safeParse(content);
  if (!spec) throw new Error("model did not return parseable JSON");
  return spec;
}
