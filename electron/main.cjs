// Electron main process. Thin host around the pure web renderer:
//  - serves the app's files over a custom `app://` scheme (ES modules can't be
//    imported from file:// in Chromium, so we need a real scheme)
//  - exposes campaign file I/O + settings over IPC (see preload.cjs)
//  - wires electron-updater so Garak's app updates itself
const { app, BrowserWindow, protocol, ipcMain } = require("electron");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const isDev = !app.isPackaged;
const APP_ROOT = isDev ? path.join(__dirname, "..") : app.getAppPath();
const USER_DIR = app.getPath("userData");
const CAMPAIGNS_DIR = path.join(USER_DIR, "campaigns");
const SAVES_DIR = path.join(USER_DIR, "saves");
const SETTINGS_FILE = path.join(USER_DIR, "settings.json");

function sanitizeId(id) {
  // Strip path-traversal and unusual chars so the campaign id can't escape SAVES_DIR.
  return String(id || "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}
function saveFileFor(campaignId) {
  return path.join(SAVES_DIR, sanitizeId(campaignId) + ".json");
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function resolveAppFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  return path.join(APP_ROOT, clean);
}

async function seedCampaigns() {
  await fsp.mkdir(CAMPAIGNS_DIR, { recursive: true });
  await fsp.mkdir(SAVES_DIR, { recursive: true });
  const existing = (await fsp.readdir(CAMPAIGNS_DIR)).filter((f) => f.endsWith(".json"));
  if (existing.length === 0) {
    const seed = path.join(APP_ROOT, "campaigns", "sample-first-morning.json");
    try {
      await fsp.copyFile(seed, path.join(CAMPAIGNS_DIR, "sample-first-morning.json"));
    } catch (e) {
      console.error("seed copy failed:", e.message);
    }
  }
}

async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function listCampaignFiles() {
  return (await fsp.readdir(CAMPAIGNS_DIR)).filter((f) => f.endsWith(".json"));
}

function registerIpc() {
  ipcMain.handle("campaigns:list", async () => {
    const out = [];
    for (const f of await listCampaignFiles()) {
      try {
        const c = await readJson(path.join(CAMPAIGNS_DIR, f));
        out.push({ id: c.id || path.basename(f, ".json"), title: c.title || f, cefrLevel: c.cefrLevel || "" });
      } catch (e) {
        console.error("bad campaign", f, e.message);
      }
    }
    return out;
  });
  ipcMain.handle("campaigns:load", async (_e, id) => readJson(path.join(CAMPAIGNS_DIR, `${id}.json`)));
  ipcMain.handle("campaigns:loadDefault", async () => {
    const files = await listCampaignFiles();
    if (!files.length) throw new Error("no campaigns installed");
    return readJson(path.join(CAMPAIGNS_DIR, files[0]));
  });
  ipcMain.handle("campaigns:save", async (_e, campaign) => {
    const id = campaign.id || `campaign-${Date.now()}`;
    const file = path.join(CAMPAIGNS_DIR, `${id}.json`);
    await fsp.writeFile(file, JSON.stringify(campaign, null, 2), "utf8");
    return { id, file };
  });
  ipcMain.handle("settings:get", async () => {
    try {
      return await readJson(SETTINGS_FILE);
    } catch {
      return {};
    }
  });
  ipcMain.handle("settings:set", async (_e, s) => {
    await fsp.writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2), "utf8");
    return s;
  });
  ipcMain.handle("settings:locate", async () => ({ path: SETTINGS_FILE, userData: USER_DIR, exists: !!(await fsp.stat(SETTINGS_FILE).catch(() => null)) }));

  // Live campaign generation via the user's Ollama (qwen2.5:7b behind Caddy).
  ipcMain.handle("ai:generate", async (_e, brief) => {
    let settings = {};
    try {
      settings = JSON.parse(await fsp.readFile(SETTINGS_FILE, "utf8"));
    } catch {}
    const password = settings.ollamaPassword || process.env.GARRAK_OLLAMA_PASSWORD;
    const baseUrl = settings.ollamaUrl || "https://10.0.0.54:11435";
    const model = settings.ollamaModel || "qwen2.5:7b";
    if (!password) throw new Error("No AI password set. Open Teacher Studio settings and save your connection first.");
    const ai = await import(pathToFileURL(path.join(APP_ROOT, "src", "core", "ai.js")).href);
    const comp = await import(pathToFileURL(path.join(APP_ROOT, "src", "core", "compile.js")).href);
    const schema = await import(pathToFileURL(path.join(APP_ROOT, "src", "core", "schema.js")).href);
    const client = ai.makeClient({ baseUrl, model, password });
    const spec = await ai.generateStorySpec(client, brief);
    const campaign = comp.compileCampaign(spec, { brief });
    return { campaign, validation: schema.validateCampaign(campaign) };
  });

  ipcMain.handle("ai:grade", async (_e, { text, bank, opts }) => {
    let settings = {};
    try {
      settings = JSON.parse(await fsp.readFile(SETTINGS_FILE, "utf8"));
    } catch {}
    const password = settings.ollamaPassword || process.env.GARRAK_OLLAMA_PASSWORD;
    const baseUrl = settings.ollamaUrl || "https://10.0.0.54:11435";
    const model = settings.ollamaModel || "qwen2.5:7b";
    if (!password) throw new Error("No AI password set.");
    const ai = await import(pathToFileURL(path.join(APP_ROOT, "src", "core", "ai.js")).href);
    const client = ai.makeClient({ baseUrl, model, password });
    // Inject the teacher's custom grader rules into every grade call.
    const enrichedOpts = { ...opts, extraRules: settings.graderRules || "" };
    return ai.aiGrade(client, text, bank, enrichedOpts);
  });

  // Per-campaign save state (resume mid-session).
  ipcMain.handle("save:get", async (_e, campaignId) => {
    try {
      return JSON.parse(await fsp.readFile(saveFileFor(campaignId), "utf8"));
    } catch {
      return null;
    }
  });
  ipcMain.handle("save:set", async (_e, { campaignId, state }) => {
    await fsp.mkdir(SAVES_DIR, { recursive: true });
    await fsp.writeFile(saveFileFor(campaignId), JSON.stringify(state), "utf8");
    return true;
  });
  ipcMain.handle("save:clear", async (_e, campaignId) => {
    try {
      await fsp.unlink(saveFileFor(campaignId));
    } catch {}
    return true;
  });

  ipcMain.handle("updater:check", async () => {
    if (isDev) return { status: "dev", message: "Dev build — updates only work in the installed app.", version: app.getVersion(), downloaded: false };
    const updater = setupUpdater();
    if (!updater) return { status: "error", message: "Updater not available", downloaded: false };
    updaterState = { status: "checking", message: "Checking for updates…", version: app.getVersion(), downloaded: false };
    try {
      await updater.checkForUpdates();
    } catch (e) {
      updaterState = { status: "error", message: `✗ ${e.message}`, downloaded: false };
    }
    return updaterState;
  });
  ipcMain.handle("updater:status", () => ({ ...updaterState, currentVersion: app.getVersion() }));
  ipcMain.handle("updater:install", () => {
    if (updaterModule && updaterState.downloaded) updaterModule.quitAndInstall();
  });

  ipcMain.handle("ai:ping", async () => {
    let settings = {};
    try {
      settings = JSON.parse(await fsp.readFile(SETTINGS_FILE, "utf8"));
    } catch {}
    const password = settings.ollamaPassword || process.env.GARRAK_OLLAMA_PASSWORD;
    const baseUrl = settings.ollamaUrl || "https://10.0.0.54:11435";
    const model = settings.ollamaModel || "qwen2.5:7b";
    if (!password) return { ok: false, error: "No password saved — fill it in and click Save." };
    try {
      const ai = await import(pathToFileURL(path.join(APP_ROOT, "src", "core", "ai.js")).href);
      const client = ai.makeClient({ baseUrl, model, password });
      // Short ping: 8s timeout, only 5 tokens of output. Fast even if model is warm-loading.
      await client.chat([{ role: "user", content: "ping" }], { format: undefined, temperature: 0, timeoutMs: 8000, numPredict: 5 });
      return { ok: true, model, url: baseUrl };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 820,
    backgroundColor: "#0b0e0c",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL("app://bundle/src/ui/index.html");
  if (process.env.GARRAK_DEVTOOLS) win.webContents.openDevTools();
  return win;
}

// Updater state - surfaced to renderer via IPC AND pushed via webContents.send
// when it changes, so the UI can show a live progress bar without polling.
let updaterState = { status: "idle", version: null, message: null, downloaded: false, percent: 0, transferred: 0, total: 0 };
let updaterModule = null;

function broadcastUpdaterState() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.webContents.isDestroyed()) win.webContents.send("updater:state", updaterState);
  }
}
function setState(patch) {
  updaterState = { ...updaterState, ...patch };
  broadcastUpdaterState();
}

function setupUpdater() {
  if (updaterModule) return updaterModule;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.on("checking-for-update", () => setState({ status: "checking", message: "Checking for updates..." }));
    autoUpdater.on("update-available", (info) => setState({ status: "downloading", version: info?.version, message: `Update v${info?.version} available - downloading...`, downloaded: false, percent: 0, transferred: 0, total: 0 }));
    autoUpdater.on("update-not-available", (info) => setState({ status: "current", version: info?.version || app.getVersion(), message: "You're up to date.", downloaded: false }));
    autoUpdater.on("download-progress", (p) => setState({ status: "downloading", percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond, message: `Downloading v${updaterState.version || ""} - ${Math.round(p.percent)}%` }));
    autoUpdater.on("update-downloaded", (info) => setState({ status: "ready", version: info?.version, message: `Update v${info?.version} ready - restart to install.`, downloaded: true, percent: 100 }));
    autoUpdater.on("error", (e) => setState({ status: "error", message: `Update error: ${e.message}` }));
    updaterModule = autoUpdater;
    return autoUpdater;
  } catch (e) {
    return null;
  }
}

app.whenReady().then(async () => {
  protocol.handle("app", async (request) => {
    try {
      const url = new URL(request.url);
      const data = await fsp.readFile(resolveAppFile(url.pathname));
      return new Response(data, { headers: { "content-type": MIME[path.extname(url.pathname)] || "application/octet-stream" } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });

  await seedCampaigns();
  registerIpc();
  const mainWindow = createWindow();

  // Auto-update — checks GitHub Releases on launch (if installed, not in dev).
  const updater = setupUpdater();
  if (updater && !isDev) updater.checkForUpdatesAndNotify().catch(() => {});

  if (process.env.GARRAK_SMOKE) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        try {
          const img = await mainWindow.webContents.capturePage();
          await fsp.writeFile(path.join(APP_ROOT, "smoke.png"), img.toPNG());
          console.log("SMOKE OK -> smoke.png");
        } catch (e) {
          console.error("smoke capture failed:", e.message);
        }
        app.quit();
      }, 1000);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
