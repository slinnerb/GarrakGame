// Platform adapter: the same renderer runs in the browser preview AND in
// Electron. In Electron, file + settings calls go through the preload bridge
// (window.garrak); in the browser we fall back to fetch / localStorage so the
// dev preview keeps working without the desktop shell.
const g = typeof window !== "undefined" ? window.garrak : null;
export const inElectron = !!g;

export async function loadDefaultCampaign() {
  if (g) return g.loadDefaultCampaign();
  const res = await fetch("/campaigns/sample-first-morning.json");
  return res.json();
}

export async function listCampaigns() {
  if (g) return g.listCampaigns();
  return [{ id: "first-morning", title: "First Morning in a New City", cefrLevel: "A1" }];
}

export async function loadCampaign(id) {
  if (g) return g.loadCampaign(id);
  const res = await fetch(`/campaigns/${id}.json`);
  return res.json();
}

export async function generateCampaign(brief) {
  if (g) return g.generateCampaign(brief);
  // browser preview proxies through the dev server which reads secret.local.txt
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `dev server returned ${res.status}`);
  return data;
}

export async function getBuildInfo() {
  // Both Electron and the dev preview serve src/ui/buildinfo.json statically.
  try {
    const res = await fetch("./buildinfo.json");
    if (res.ok) return await res.json();
  } catch {}
  return { version: "?", sha: "?", buildDate: "" };
}

export async function pingAi() {
  if (g && g.pingAi) return g.pingAi();
  try {
    const res = await fetch("/api/ping");
    if (!res.ok) return { ok: false, error: `server ${res.status}` };
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function checkForUpdates() {
  if (g && g.checkForUpdates) return g.checkForUpdates();
  return { status: "dev", message: "Dev preview — updates only work in the installed app.", version: "0.1.0", downloaded: false };
}
export async function installUpdate() {
  if (g && g.installUpdate) return g.installUpdate();
}

export async function gradeAnswer(text, bank, opts) {
  if (g && g.gradeAnswer) return g.gradeAnswer({ text, bank, opts });
  const res = await fetch("/api/grade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, bank, opts }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `dev server returned ${res.status}`);
  return data;
}

export async function saveCampaign(campaign) {
  if (g) return g.saveCampaign(campaign);
  // browser fallback: download as a file
  const blob = new Blob([JSON.stringify(campaign, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${campaign.id || "campaign"}.json`;
  a.click();
  return { id: campaign.id, file: a.download };
}

export async function getSettings() {
  if (g) return g.getSettings();
  try {
    return JSON.parse(localStorage.getItem("garrak.settings") || "{}");
  } catch {
    return {};
  }
}

export async function setSettings(s) {
  if (g) return g.setSettings(s);
  localStorage.setItem("garrak.settings", JSON.stringify(s));
  return s;
}
