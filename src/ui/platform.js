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
