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
