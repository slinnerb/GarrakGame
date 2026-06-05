// Manual "Check for updates" button + live update banner. Subscribes to push
// events from the Electron main process so the download progress bar updates
// in real time without polling. Falls back gracefully in the browser preview.
import { checkForUpdates, installUpdate, onUpdaterState } from "./platform.js";

const ICON = { idle: "", checking: "⟳", current: "✓", downloading: "↓", ready: "✓", error: "!", dev: "ⓘ" };

function fmtMB(bytes) {
  if (!bytes || bytes <= 0) return "";
  return (bytes / 1048576).toFixed(1) + " MB";
}
function fmtSpeed(bps) {
  if (!bps || bps <= 0) return "";
  return (bps / 1048576).toFixed(1) + " MB/s";
}

function renderDownloadBanner(state) {
  const pct = Math.max(0, Math.min(100, Math.round(state.percent || 0)));
  const transferred = fmtMB(state.transferred);
  const total = fmtMB(state.total);
  const speed = fmtSpeed(state.bytesPerSecond);
  const label =
    state.version
      ? `Downloading v${state.version} — ${pct}%${transferred && total ? ` (${transferred} / ${total})` : ""}${speed ? ` · ${speed}` : ""}`
      : `Downloading… ${pct}%`;
  return `
    <div class="ub-progress">
      <div class="ub-progress-label">${escapeHtml(label)}</div>
      <div class="ub-progress-track"><div class="ub-progress-fill" style="width: ${pct}%"></div></div>
    </div>`;
}

function showBanner(state, opts = {}) {
  const el = document.getElementById("update-banner");
  if (!el) return;
  if (!state) {
    el.className = "update-banner";
    el.innerHTML = "";
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
    return;
  }
  const status = state.status || "current";
  el.className = `update-banner show ${status}`;

  const isDownloading = status === "downloading" && (state.percent > 0 || state.total > 0);
  const middle = isDownloading
    ? renderDownloadBanner(state)
    : `<span class="ub-msg">${escapeHtml(state.message || "")}</span>`;
  const action = status === "ready" ? `<button class="ub-action">Restart &amp; install</button>` : "";

  el.innerHTML = `
    <span class="ub-icon">${escapeHtml(ICON[status] || "•")}</span>
    ${middle}
    ${action}
    <button class="ub-dismiss" title="Dismiss">×</button>`;

  const actionBtn = el.querySelector(".ub-action");
  if (actionBtn) actionBtn.onclick = () => installUpdate();
  el.querySelector(".ub-dismiss").onclick = () => showBanner(null);

  // Auto-hide only for terminal happy states, not for downloads-in-flight.
  if (autoHideTimer) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
  if ((status === "current" || status === "dev") && !opts.sticky) {
    autoHideTimer = setTimeout(() => showBanner(null), 4500);
  }
}

let autoHideTimer = null;

async function onCheck() {
  const btn = document.getElementById("check-update");
  if (btn) btn.disabled = true;
  showBanner({ status: "checking", message: "Checking for updates..." });
  try {
    const r = await checkForUpdates();
    // In Electron with subscriptions, push events take over. For dev / browser
    // and for one-shot states (current / error), render the immediate result.
    if (r && (r.status === "dev" || r.status === "current" || r.status === "error" || r.status === "ready")) {
      showBanner(r);
    }
    // Otherwise (downloading), the push subscription will keep rendering live updates.
  } catch (e) {
    showBanner({ status: "error", message: "✗ " + e.message });
  } finally {
    if (btn) btn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

document.getElementById("check-update")?.addEventListener("click", onCheck);

// Subscribe ONCE to live updater state from the main process (Electron only).
// Every status change - checking, downloading-progress, ready, error -
// streams in and re-renders the banner immediately. Continuous progress UI
// with no polling.
onUpdaterState((state) => {
  if (!state || state.status === "idle") return;
  showBanner(state);
});
