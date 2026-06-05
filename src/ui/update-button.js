// Wires the "Check for updates" button + status text shared by both screens.
import { checkForUpdates, installUpdate } from "./platform.js";

const STATUS_CLASS = { idle: "dim", checking: "dim", current: "ok", downloading: "amber", ready: "ok", error: "bad", dev: "dim" };

function setStatus(text, status = "idle") {
  const el = document.getElementById("update-status");
  if (!el) return;
  el.innerHTML = text ? `<span class="${STATUS_CLASS[status] || "dim"}">${escapeHtml(text)}</span>` : "";
  if (status === "ready") {
    const btn = document.createElement("button");
    btn.textContent = "Restart & install";
    btn.className = "install-btn";
    btn.onclick = () => installUpdate();
    el.appendChild(document.createTextNode(" "));
    el.appendChild(btn);
  }
}

async function onCheck() {
  const btn = document.getElementById("check-update");
  if (btn) btn.disabled = true;
  setStatus("Checking…", "checking");
  try {
    const r = await checkForUpdates();
    setStatus(r.message || r.status, r.status);
    if (r.status === "current") setTimeout(() => setStatus(""), 4000);
  } catch (e) {
    setStatus("✗ " + e.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.getElementById("check-update")?.addEventListener("click", onCheck);
