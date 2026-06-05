// Electron main process. Thin host around the pure web renderer:
//  - serves the app's files over a custom `app://` scheme (ES modules can't be
//    imported from file:// in Chromium, so we need a real scheme)
//  - exposes campaign file I/O + settings over IPC (see preload.cjs)
//  - wires electron-updater so Garak's app updates itself
const { app, BrowserWindow, protocol, ipcMain } = require("electron");
const fsp = require("node:fs/promises");
const path = require("node:path");

const isDev = !app.isPackaged;
const APP_ROOT = isDev ? path.join(__dirname, "..") : app.getAppPath();
const USER_DIR = app.getPath("userData");
const CAMPAIGNS_DIR = path.join(USER_DIR, "campaigns");
const SETTINGS_FILE = path.join(USER_DIR, "settings.json");

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

  // Auto-update: only meaningful once a GitHub release exists and publish
  // owner/repo are filled in package.json. Safe no-op otherwise.
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    if (!isDev) autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.warn("electron-updater not active:", e.message);
  }

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
