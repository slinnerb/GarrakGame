// Teacher Studio: brief -> generate (real qwen2.5 in the desktop app) ->
// review/edit JSON -> play-test or save. Generation + file I/O go through the
// platform adapter; campaign validation runs right here in the renderer.
import { generateCampaign, saveCampaign, getSettings, setSettings, pingAi, getBuildInfo, inElectron } from "./platform.js";

(async () => {
  const b = await getBuildInfo();
  const el = document.getElementById("build-badge");
  if (el) {
    el.textContent = `v${b.version}${b.sha && b.sha !== "?" ? " · " + b.sha + (b.dirty ? "*" : "") : ""}`;
    el.title = `${b.product || "Garak Game"}\nversion ${b.version}\nbuild ${b.sha}${b.dirty ? " (uncommitted changes)" : ""}\n${b.buildDate}`;
  }
})();
import { validateCampaign } from "../core/schema.js";

const $ = (id) => document.getElementById(id);

async function loadSettings() {
  const s = await getSettings();
  $("set-url").value = s.ollamaUrl || "https://10.0.0.54:11435";
  $("set-model").value = s.ollamaModel || "qwen2.5:7b";
  $("set-pass").value = s.ollamaPassword || "";
  $("env-note").textContent = inElectron
    ? "Desktop app — settings save automatically (per-user)."
    : "Browser preview — using local secret.local.txt for the password.";
}

let saveTimer = null;
async function saveConn(immediate) {
  clearTimeout(saveTimer);
  const doSave = async () => {
    await setSettings({
      ollamaUrl: $("set-url").value.trim(),
      ollamaModel: $("set-model").value.trim(),
      ollamaPassword: $("set-pass").value,
    });
    $("save-state").textContent = "saved ✓";
    setTimeout(() => ($("save-state").textContent = ""), 1500);
  };
  if (immediate) return doSave();
  $("save-state").textContent = "saving…";
  saveTimer = setTimeout(doSave, 400);
}

async function checkConn() {
  setConnBadge("dim", "checking…");
  const r = await pingAi();
  if (r.ok) setConnBadge("ok", `Connected — ${r.model || "AI"}`);
  else setConnBadge("bad", r.error || "Not connected");
}

function setConnBadge(cls, text) {
  const badge = $("conn-badge");
  badge.querySelector(".dot").className = `dot ${cls}`;
  $("conn-text").textContent = text;
}

function setStatus(msg) {
  $("gen-status").textContent = msg || "";
}

// Chip-list state for the Target Language field. Each chip is one
// vocab/phrase/grammar point Garak wants the campaign to teach.
const targetItems = [];

function renderTargetChips() {
  const el = $("b-target-chips");
  if (!targetItems.length) {
    el.innerHTML = `<span class="dim small">(no target items yet — type one and press Enter)</span>`;
    return;
  }
  el.innerHTML = targetItems
    .map(
      (t, i) =>
        `<span class="chip"><span class="chip-text">${esc(t)}</span><button class="chip-x" data-i="${i}" title="Remove">×</button></span>`
    )
    .join("");
  el.querySelectorAll(".chip-x").forEach((b) => (b.onclick = () => {
    targetItems.splice(parseInt(b.dataset.i, 10), 1);
    renderTargetChips();
  }));
}

function addTargetFromInput() {
  const input = $("b-target-input");
  const raw = input.value;
  // Accept comma- or newline-separated paste; split + dedupe; trim each
  const parts = raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  let added = 0;
  for (const p of parts) {
    if (!targetItems.some((x) => x.toLowerCase() === p.toLowerCase())) {
      targetItems.push(p);
      added++;
    }
  }
  input.value = "";
  input.focus();
  renderTargetChips();
  return added;
}

function brief() {
  return {
    idea: $("b-idea").value.trim(),
    cefrLevel: $("b-level").value,
    targetLanguage: targetItems.join(", "),
    interests: $("b-interests").value.trim(),
    length: $("b-length").value,
    l1: "Japanese (kana/kanji + romaji)",
  };
}

async function onGenerate() {
  if (!$("b-idea").value.trim()) {
    setStatus("Write a campaign idea first.");
    return;
  }
  $("gen-btn").disabled = true;
  setStatus(inElectron ? "Generating with qwen2.5:7b … this can take ~1-2 minutes." : "Loading sample…");
  try {
    const t0 = performance.now();
    const { campaign, validation, browserSample } = await generateCampaign(brief());
    renderResult(campaign, validation, browserSample, ((performance.now() - t0) / 1000).toFixed(1));
    setStatus("");
  } catch (e) {
    setStatus("✗ " + e.message);
  } finally {
    $("gen-btn").disabled = false;
  }
}

function renderResult(c, v, browserSample, secs) {
  $("result").style.display = "block";
  const outline = (c.sections || [])
    .map((s) => {
      const words = s.targetLanguageBank.map((t) => t.text).join(", ");
      return `<li><b>${esc(s.title)}</b> <span class="dim">— ${s.targetLanguageBank.length} words: ${esc(words)}</span></li>`;
    })
    .join("");
  const nodeCount = Object.keys(c.nodes || {}).length;
  $("result-head").innerHTML =
    `<h3>${esc(c.title)} <span class="dim small">[${esc(c.cefrLevel)}]</span></h3>
     <div class="dim small">${browserSample ? "browser sample" : "generated in " + secs + "s"} · ${nodeCount} nodes · spells: ${(c.spellPool || []).map((s) => esc(s.name)).join(", ") || "none"}</div>
     <ul class="outline">${outline}</ul>`;
  $("json-edit").value = JSON.stringify(c, null, 2);
  showValidation(v);
}

function showValidation(v) {
  $("validation").innerHTML = v.ok
    ? `<span class="ok">✓ valid campaign</span>`
    : `<span class="bad">✗ ${v.errors.length} issue(s):</span><ul>${v.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`;
}

function parseEdited() {
  try {
    return JSON.parse($("json-edit").value);
  } catch (e) {
    $("validation").innerHTML = `<span class="bad">✗ JSON parse error: ${esc(e.message)}</span>`;
    return null;
  }
}

function onValidate() {
  const c = parseEdited();
  if (c) showValidation(validateCampaign(c));
}

function onPlaytest() {
  const c = parseEdited();
  if (!c) return;
  const v = validateCampaign(c);
  if (!v.ok) return showValidation(v);
  sessionStorage.setItem("garrak.playtest", JSON.stringify(c));
  window.location.href = "./index.html";
}

async function onSave() {
  const c = parseEdited();
  if (!c) return;
  const v = validateCampaign(c);
  if (!v.ok) return showValidation(v);
  try {
    const r = await saveCampaign(c);
    setStatus("Saved: " + (r.file || r.id));
  } catch (e) {
    setStatus("✗ save failed: " + e.message);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("b-target-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addTargetFromInput();
  }
});
$("b-target-add").onclick = addTargetFromInput;
renderTargetChips();

$("gen-btn").onclick = onGenerate;
$("btn-validate").onclick = onValidate;
$("btn-playtest").onclick = onPlaytest;
$("btn-save").onclick = onSave;
$("test-conn").onclick = checkConn;
// auto-save settings on any change (debounced) so the user never has to click "Save"
["set-url", "set-model", "set-pass"].forEach((id) => {
  $(id).addEventListener("input", () => saveConn(false));
});
(async () => {
  await loadSettings();
  await checkConn();
})();
