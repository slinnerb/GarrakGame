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
  $("set-grader-rules").value = s.graderRules || "";
  // In browser-preview mode the rules live on the dev server (so the proxy can
  // inject them); fetch the current value when we're in browser mode.
  if (!inElectron) {
    try {
      const r = await fetch("/api/grader-rules");
      if (r.ok) {
        const data = await r.json();
        if (data.rules) $("set-grader-rules").value = data.rules;
      }
    } catch {}
  }
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
      graderRules: $("set-grader-rules").value,
    });
    $("save-state").textContent = "saved ✓";
    setTimeout(() => ($("save-state").textContent = ""), 1500);
  };
  if (immediate) return doSave();
  $("save-state").textContent = "saving…";
  saveTimer = setTimeout(doSave, 400);
}

let rulesSaveTimer = null;
function saveGraderRules() {
  clearTimeout(rulesSaveTimer);
  $("rules-state").textContent = "saving…";
  rulesSaveTimer = setTimeout(async () => {
    await setSettings({
      ollamaUrl: $("set-url").value.trim(),
      ollamaModel: $("set-model").value.trim(),
      ollamaPassword: $("set-pass").value,
      graderRules: $("set-grader-rules").value,
    });
    // Also push to dev server in browser preview so the /api/grade proxy reads them
    if (!inElectron) {
      try {
        await fetch("/api/grader-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rules: $("set-grader-rules").value }),
        });
      } catch {}
    }
    $("rules-state").textContent = "saved ✓";
    setTimeout(() => ($("rules-state").textContent = ""), 1500);
  }, 500);
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

// Reusable chip-list field. Used for both Target Language and Student Interests.
// Returns the (mutable) items array so callers can read it later for brief().
function createChipField(inputId, addBtnId, chipsId, emptyMsg) {
  const items = [];
  const inputEl = $(inputId);
  const chipsEl = $(chipsId);
  const addBtnEl = $(addBtnId);

  function render() {
    if (!items.length) {
      chipsEl.innerHTML = `<span class="dim small">${esc(emptyMsg)}</span>`;
      return;
    }
    chipsEl.innerHTML = items
      .map(
        (t, i) =>
          `<span class="chip"><span class="chip-text">${esc(t)}</span><button class="chip-x" data-i="${i}" title="Remove">×</button></span>`
      )
      .join("");
    chipsEl.querySelectorAll(".chip-x").forEach((b) => (b.onclick = () => {
      items.splice(parseInt(b.dataset.i, 10), 1);
      render();
    }));
  }

  function addFromInput() {
    // Accept comma/newline-separated paste; trim + dedupe (case-insensitive)
    const parts = inputEl.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      if (!items.some((x) => x.toLowerCase() === p.toLowerCase())) items.push(p);
    }
    inputEl.value = "";
    inputEl.focus();
    render();
  }

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addFromInput();
    }
  });
  addBtnEl.onclick = addFromInput;
  render();
  return items;
}

const targetItems = createChipField(
  "b-target-input",
  "b-target-add",
  "b-target-chips",
  "(no target items yet — type one and press Enter)"
);
const interestItems = createChipField(
  "b-interests-input",
  "b-interests-add",
  "b-interests-chips",
  "(no interests yet — type one and press Enter)"
);

function brief() {
  return {
    idea: $("b-idea").value.trim(),
    cefrLevel: $("b-level").value,
    targetLanguage: targetItems.join(", "),
    interests: interestItems.join(", "),
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
  setStatus("Generating with qwen2.5:7b … this can take ~1-2 minutes.");
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

// Current campaign being edited - the source of truth. Editor inputs mutate
// this object directly via onChange handlers; Save / Play-test / Validate all
// read from here. No more parsing user-edited JSON.
let currentCampaign = null;

function renderResult(c, v, browserSample, secs) {
  currentCampaign = c;
  const resultEl = $("result");
  resultEl.style.display = "block";
  resultEl.innerHTML = ""; // wipe; we rebuild as DOM

  const nodeCount = Object.keys(c.nodes || {}).length;

  // ----- HEAD -----
  const head = el("div", "ed-head");
  head.appendChild(text("h3", `${c.title || "Untitled"}`, "ed-title-text amber"));
  head.appendChild(text("div", `${browserSample ? "browser sample" : "generated in " + secs + "s"} · ${esc(c.cefrLevel || "?")} · ${nodeCount} nodes · ${(c.spellPool || []).length} spells`, "dim small"));
  resultEl.appendChild(head);

  // ----- TITLE + PREMISE -----
  const titleHeading = head.querySelector(".ed-title-text");
  field(resultEl, "Campaign title", "text", c.title || "", (v) => {
    c.title = v;
    if (titleHeading) titleHeading.textContent = v;
  });
  field(resultEl, "Premise (the opening situation)", "textarea", c.premise || "", (v) => (c.premise = v), 3);

  // ----- SECTIONS -----
  resultEl.appendChild(text("h4", "Sections", "ed-h"));
  (c.sections || []).forEach((sec, si) => {
    const det = el("details", "ed-section");
    det.open = true;
    const summary = el("summary");
    const sumLabel = el("span", "amber");
    sumLabel.textContent = sec.title || `Section ${si + 1}`;
    summary.appendChild(document.createTextNode(`Section ${si + 1}: `));
    summary.appendChild(sumLabel);
    det.appendChild(summary);

    const body = el("div", "ed-section-body");
    det.appendChild(body);

    field(body, "Section title", "text", sec.title || "", (v) => {
      sec.title = v;
      sumLabel.textContent = v;
    });

    const bankInitial = (sec.targetLanguageBank || []).map((b) => b.text).join("\n");
    field(
      body,
      "Target language for this section (one word or phrase per line)",
      "textarea",
      bankInitial,
      (v) => {
        const lines = v.split("\n").map((s) => s.trim()).filter(Boolean);
        // Preserve existing l1Hint / type when text matches; otherwise default.
        const oldByText = new Map((sec.targetLanguageBank || []).map((b) => [b.text.toLowerCase(), b]));
        sec.targetLanguageBank = lines.map((t) => {
          const prev = oldByText.get(t.toLowerCase());
          return prev ? { ...prev, text: t } : { text: t, type: "vocab", l1Hint: null };
        });
      },
      Math.max(3, (sec.targetLanguageBank || []).length + 1)
    );

    // Scenes in this section (skip ending + consequence nodes — internal)
    const sceneNodes = Object.values(c.nodes || {}).filter((n) => n.sectionId === sec.id && !n.isEnding && !n.isConsequence);
    sceneNodes.forEach((node, ni) => {
      const scene = el("div", "ed-scene");
      scene.appendChild(text("div", `Scene ${ni + 1}`, "ed-scene-label"));
      body.appendChild(scene);

      field(scene, "What the player sees here", "textarea", node.text || "", (v) => (node.text = v), 2);

      // Choices section — re-renders when the teacher adds or removes a choice
      const choicesEl = el("div", "ed-choices-wrap");
      scene.appendChild(choicesEl);
      renderChoices(choicesEl, node);
    });

    resultEl.appendChild(det);
  });

  // ----- SPELLS -----
  if (c.spellPool && c.spellPool.length) {
    resultEl.appendChild(text("h4", "Spells the student starts with", "ed-h"));
    c.spellPool.forEach((sp, si) => {
      const wrap = el("div", "ed-spell");
      wrap.appendChild(text("div", `Spell ${si + 1}`, "ed-scene-label"));
      field(wrap, "Name", "text", sp.name || "", (v) => (sp.name = v));
      field(wrap, "Flavor (one-line description)", "text", sp.flavor || "", (v) => (sp.flavor = v));
      resultEl.appendChild(wrap);
    });
  }

  // ----- ACTION BUTTONS -----
  const actions = el("div", "row ed-actions");
  actions.innerHTML = `
    <button id="btn-validate">Validate</button>
    <button id="btn-playtest">▶ Play-test</button>
    <button id="btn-save" class="primary save-btn">💾 Save to library</button>
  `;
  resultEl.appendChild(actions);

  const validation = el("div");
  validation.id = "validation";
  validation.className = "validation";
  resultEl.appendChild(validation);

  // Save-success banner (lives below the buttons; we update text + class in onSave)
  const banner = el("div");
  banner.id = "save-banner";
  banner.className = "save-banner";
  resultEl.appendChild(banner);

  // ----- ADVANCED: read-only JSON view -----
  const adv = el("details", "ed-advanced");
  adv.innerHTML = `<summary>⚙ Show raw JSON (advanced, read-only)</summary><pre class="json-readonly"></pre>`;
  resultEl.appendChild(adv);
  const jsonPre = adv.querySelector("pre");
  const updateJson = () => (jsonPre.textContent = JSON.stringify(c, null, 2));
  updateJson();
  resultEl.querySelectorAll("input, textarea").forEach((inp) => inp.addEventListener("input", updateJson));

  // Wire actions
  $("btn-validate").onclick = onValidate;
  $("btn-playtest").onclick = onPlaytest;
  $("btn-save").onclick = onSave;

  showValidation(v);
}

// Renders (and re-renders) the choices block for a single scene node.
// Adding or removing a choice mutates node.choices in place, then calls back
// into this function to repaint just this scene's rows.
function renderChoices(container, node) {
  container.innerHTML = "";
  if (node.choices && node.choices.length) {
    container.appendChild(text("div", "Choices the player can pick", "ed-label"));
    node.choices.forEach((ch, ci) => {
      const row = el("div", "ed-choice");
      row.appendChild(text("span", "▸", "ed-arrow"));
      const input = el("input", "ed-input ed-input-inline");
      input.type = "text";
      input.value = ch.label || "";
      input.placeholder = `Choice ${ci + 1}`;
      input.addEventListener("change", () => (ch.label = input.value));
      input.addEventListener("blur", () => (ch.label = input.value));
      row.appendChild(input);

      // Remove button — only shown when there's more than one choice, so the
      // engine's "non-ending node needs at least one choice" invariant holds.
      if (node.choices.length > 1) {
        const rm = el("button", "ed-choice-rm");
        rm.type = "button";
        rm.innerHTML = "×";
        rm.title = "Remove this choice";
        rm.onclick = () => {
          node.choices.splice(ci, 1);
          renderChoices(container, node);
        };
        row.appendChild(rm);
      }
      container.appendChild(row);

      if (ch.writeIn && ch.writeIn.prompt) {
        field(container, `▸ ${ch.label || "Choice " + (ci + 1)} - write-in prompt`, "text", ch.writeIn.prompt, (v) => (ch.writeIn.prompt = v));
      }
    });
  }

  // + Add choice — appends a blank choice that leads to the same next node
  // as the existing choices (preserves the campaign's graph automatically).
  const addBtn = el("button", "ed-add-choice");
  addBtn.type = "button";
  addBtn.textContent = "+ Add choice";
  addBtn.title = "Add another response for the player to pick";
  addBtn.onclick = () => {
    if (!node.choices) node.choices = [];
    const proto = node.choices.find((c) => c?.onSuccess?.nextNodeId) || node.choices[0];
    const next = proto?.onSuccess?.nextNodeId;
    node.choices.push({
      id: `${node.id}_c_${Math.random().toString(36).slice(2, 8)}`,
      label: "",
      onSuccess: { nextNodeId: next, points: 2, text: "" },
    });
    renderChoices(container, node);
    // Focus the freshly added input so they can type right away
    const inputs = container.querySelectorAll(".ed-choice .ed-input-inline");
    inputs[inputs.length - 1]?.focus();
  };
  container.appendChild(addBtn);
}

// --- tiny DOM helpers (keep the editor readable) ---
function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}
function text(tag, content, cls) {
  const e = el(tag, cls);
  e.textContent = content;
  return e;
}
function field(parent, labelText, type, value, onChange, rows = 1) {
  const wrap = el("div", "ed-field");
  const lbl = text("label", labelText, "ed-label");
  wrap.appendChild(lbl);
  let input;
  if (type === "textarea") {
    input = el("textarea", "ed-input");
    input.rows = rows;
  } else {
    input = el("input", "ed-input");
    input.type = "text";
  }
  input.value = value;
  input.addEventListener("change", () => onChange(input.value));
  input.addEventListener("blur", () => onChange(input.value));
  wrap.appendChild(input);
  parent.appendChild(wrap);
  return input;
}

function showValidation(v) {
  const el = document.getElementById("validation");
  if (!el) return;
  el.innerHTML = v.ok
    ? `<span class="ok">✓ valid campaign</span>`
    : `<span class="bad">✗ ${v.errors.length} issue(s):</span><ul>${v.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`;
}

function flashBanner(text, kind) {
  const b = document.getElementById("save-banner");
  if (!b) return;
  b.className = "save-banner show " + (kind || "");
  b.textContent = text;
  // Auto-fade after a moment for success; sticky for errors
  if (kind === "ok") setTimeout(() => (b.className = "save-banner"), 4000);
}

function onValidate() {
  if (!currentCampaign) return;
  showValidation(validateCampaign(currentCampaign));
}

function onPlaytest() {
  if (!currentCampaign) return;
  const v = validateCampaign(currentCampaign);
  if (!v.ok) return showValidation(v);
  sessionStorage.setItem("garrak.playtest", JSON.stringify(currentCampaign));
  window.location.href = "./index.html";
}

async function onSave() {
  if (!currentCampaign) return;
  const v = validateCampaign(currentCampaign);
  if (!v.ok) {
    showValidation(v);
    flashBanner("Can't save — fix the validation issues first.", "bad");
    return;
  }
  const btn = $("btn-save");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = "Saving…";
  try {
    const r = await saveCampaign(currentCampaign);
    btn.innerHTML = "✓ Saved!";
    btn.classList.add("saved");
    flashBanner(`✓ Saved to your library as "${currentCampaign.title}". Find it later under Load Campaign.`, "ok");
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.remove("saved");
      btn.disabled = false;
    }, 2500);
  } catch (e) {
    btn.innerHTML = original;
    btn.disabled = false;
    flashBanner("✗ Save failed: " + e.message, "bad");
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}


$("gen-btn").onclick = onGenerate;
$("btn-validate").onclick = onValidate;
$("btn-playtest").onclick = onPlaytest;
$("btn-save").onclick = onSave;
$("test-conn").onclick = checkConn;
// auto-save settings on any change (debounced) so the user never has to click "Save"
["set-url", "set-model", "set-pass"].forEach((id) => {
  $(id).addEventListener("input", () => saveConn(false));
});
$("set-grader-rules").addEventListener("input", saveGraderRules);
(async () => {
  await loadSettings();
  await checkConn();
})();
