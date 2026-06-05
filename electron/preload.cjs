// Preload: exposes a small, safe API to the renderer (no Node access leaks).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("garrak", {
  isElectron: true,
  listCampaigns: () => ipcRenderer.invoke("campaigns:list"),
  loadCampaign: (id) => ipcRenderer.invoke("campaigns:load", id),
  loadDefaultCampaign: () => ipcRenderer.invoke("campaigns:loadDefault"),
  saveCampaign: (campaign) => ipcRenderer.invoke("campaigns:save", campaign),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (settings) => ipcRenderer.invoke("settings:set", settings),
  generateCampaign: (brief) => ipcRenderer.invoke("ai:generate", brief),
  pingAi: () => ipcRenderer.invoke("ai:ping"),
});
