// Dev preview server. Static files + tiny JSON API that proxies generation +
// connection-ping through to the user's Ollama, using the password from
// secret.local.txt (read locally, never sent to the browser). Means the
// browser preview behaves like the real desktop app instead of falling back
// to a cached sample.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const PORT = process.env.PORT || 4178;
const SECRET_FILE = join(ROOT, "secret.local.txt");
const DEFAULT_URL = "https://10.0.0.54:11435";
const DEFAULT_MODEL = "qwen2.5:7b";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function readSecret() {
  try {
    return (await readFile(SECRET_FILE, "utf8")).trim();
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8") || "{}"));
    req.on("error", reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

let aiPromise; // lazy-load so the static server boots fast
function loadAi() {
  if (!aiPromise) {
    aiPromise = Promise.all([
      import(pathToFileURL(join(ROOT, "src/core/ai.js")).href),
      import(pathToFileURL(join(ROOT, "src/core/compile.js")).href),
      import(pathToFileURL(join(ROOT, "src/core/schema.js")).href),
    ]).then(([ai, comp, schema]) => ({ ai, comp, schema }));
  }
  return aiPromise;
}

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/ping") {
      const password = await readSecret();
      if (!password) return sendJson(res, 200, { ok: false, error: "No secret.local.txt found" });
      const { ai } = await loadAi();
      try {
        const client = ai.makeClient({ baseUrl: DEFAULT_URL, model: DEFAULT_MODEL, password });
        // ping with a tiny call; the Ollama generate endpoint with a one-token
        // budget returns fast and confirms auth + the model is loaded.
        await client.chat([{ role: "user", content: "ping" }], { format: undefined, temperature: 0 });
        return sendJson(res, 200, { ok: true, model: DEFAULT_MODEL, url: DEFAULT_URL });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }

    if (req.method === "POST" && req.url === "/api/generate") {
      const password = await readSecret();
      if (!password) return sendJson(res, 503, { error: "No secret.local.txt — dev preview can't reach Ollama. Run the desktop app for live generation." });
      const body = JSON.parse(await readBody(req));
      const { ai, comp, schema } = await loadAi();
      try {
        const client = ai.makeClient({ baseUrl: DEFAULT_URL, model: DEFAULT_MODEL, password });
        const spec = await ai.generateStorySpec(client, body.brief || {});
        const campaign = comp.compileCampaign(spec, { brief: body.brief });
        return sendJson(res, 200, { campaign, validation: schema.validateCampaign(campaign) });
      } catch (e) {
        return sendJson(res, 500, { error: e.message });
      }
    }

    // static
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/" || p === "") {
      res.writeHead(302, { Location: "/src/ui/index.html" });
      return res.end();
    }
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT + sep) && file !== ROOT) {
      res.writeHead(403);
      return res.end("forbidden");
    }
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (!res.headersSent) res.writeHead(404);
    res.end("not found");
  }
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
