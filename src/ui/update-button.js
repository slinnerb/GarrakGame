// Manual "Check for updates" button. Writes status into a dedicated slim
// banner below the topbar (NOT into the topbar itself) so a long status string
// like "Update v0.1.3 available — downloading 42%" never shoves the HUD around.
// The banner appears only when there's something to show and can be dismissed.
import { checkForUpdates, installUpdate } from "./platform.js";

const ICON = { idle: "", checking: "⟳", current: "✓", downloading: "↓", ready: "✓", error: "!", dev: "ⓘ" };

function showBanner(text, status, opts = {}) {
  const el = document.getElementById("update-banner");
  if (!el) return;
  if (!text) {
    el.className = "update-banner";
    el.innerHTML = "";
    return;
  }
  el.className = `update-banner show ${status || ""}`;
  el.innerHTML = `<span class="ub-icon">${escapeHtml(ICON[status] || "•")}</span>
    <span class="ub-msg">${escapeHtml(text)}</span>
    <span class="ub-spacer"></span>
    ${opts.actionLabel ? `<button class="ub-action">${escapeHtml(opts.actionLabel)}</button>` : ""}
    <button class="ub-dismiss" title="Dismiss">×</button>`;
  const action = el.querySelector(".ub-action");
  if (action && opts.onAction) action.onclick = opts.onAction;
  el.querySelector(".ub-dismiss").onclick = () => showBanner("");
  if (opts.autoHideMs) setTimeout(() => showBanner(""), opts.autoHideMs);
}

async function onCheck() {
  const btn = document.getElementById("check-update");
  if (btn) btn.disabled = true;
  showBanner("Checking for updates…", "checking");
  try {
    const r = await checkForUpdates();
    if (r.status === "current") {
      showBanner(r.message || "You're up to date.", "current", { autoHideMs: 4000 });
    } else if (r.status === "ready") {
      showBanner(r.message || "Update ready.", "ready", { actionLabel: "Restart & install", onAction: () => installUpdate() });
    } else if (r.status === "downloading") {
      showBanner(r.message || "Downloading…", "downloading");
    } else if (r.status === "dev") {
      showBanner(r.message || "Dev build.", "dev", { autoHideMs: 5000 });
    } else if (r.status === "error") {
      showBanner(r.message || "Update check failed.", "error");
    } else {
      showBanner(r.message || r.status || "", "current", { autoHideMs: 4000 });
    }
  } catch (e) {
    showBanner("✗ " + e.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.getElementById("check-update")?.addEventListener("click", onCheck);
