// Player UI - a thin renderer over the pure engine. It only calls engine
// functions and draws whatever view() returns. This same page is what Electron
// will load in its window (and, later, a remote client over HTTPS).
import {
  createSession,
  view,
  choose,
  submitWriteIn,
  resolveCheck,
  reroll,
  pickAnother,
  castSpell,
  PHASES,
} from "../core/engine.js";
import { loadDefaultCampaign } from "./platform.js";

const $ = (id) => document.getElementById(id);
let campaign = null;
let session = null;

async function boot() {
  campaign = await loadDefaultCampaign();
  newSession();
}

function newSession() {
  session = createSession(campaign, {
    difficulty: $("difficulty").value,
    hintsOn: $("hints").checked,
    rng: Math.random,
  });
  setStatus("");
  render();
}

function act(fn) {
  try {
    fn();
    setStatus("");
  } catch (e) {
    setStatus("! " + e.message);
  }
  render();
}

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function render() {
  const vw = view(session);
  renderHud(vw.hud);
  renderBank(vw);
  renderSpellbook(vw);
  $("ascii").textContent = vw.node.ascii || "";
  $("scene").textContent = vw.node.text || "";
  $("clue").textContent = vw.node.clue ? "✶ " + vw.node.clue : "";
  renderInteraction(vw);
  renderFeedback(vw);
}

function renderHud(hud) {
  const bars = 18;
  const filled = Math.round((hud.progressPct / 100) * bars);
  const bar = "█".repeat(filled) + "░".repeat(bars - filled);
  $("hud").innerHTML =
    `<span>★ Points <b>${hud.points}</b></span>` +
    `<span>Progress [${bar}] ${hud.progressPct}%</span>` +
    `<span>✦ Inspiration <b>${hud.inspiration}</b></span>` +
    `<span class="dim">[${hud.difficulty}]</span>`;
}

function renderBank(vw) {
  const items = vw.bank
    .map((t) => {
      const hint = t.hint ? ` <span class="dim">(${escapeHtml(t.hint)})</span>` : "";
      return `<li><span class="tl">${escapeHtml(t.text)}</span>${hint}</li>`;
    })
    .join("");
  const title = vw.section ? vw.section.title : "";
  $("bank").innerHTML = `<h3>Target Language &mdash; ${escapeHtml(title)}</h3><ul class="bank">${items}</ul>`;
}

function renderSpellbook(vw) {
  const spells = vw.spells
    .map((sp) => {
      const cls = sp.used ? "spell used" : "spell";
      const disabled = sp.used ? "disabled" : "";
      return `<li class="${cls}">
        <button class="spellbtn" data-spell="${sp.id}" ${disabled}>${escapeHtml(sp.icon || "✦")} ${escapeHtml(sp.name)}</button>
        <div class="dim small">${escapeHtml(sp.flavor || "")}</div>
      </li>`;
    })
    .join("");
  $("spellbook").innerHTML = `<h3>Spellbook</h3><ul class="spells">${spells || "<li class='dim'>(empty)</li>"}</ul>`;
  $("spellbook")
    .querySelectorAll(".spellbtn")
    .forEach((b) => (b.onclick = () => onCastSpell(b.dataset.spell)));
}

function renderInteraction(vw) {
  const el = $("interaction");

  if (vw.ended) {
    el.innerHTML = `<div class="ending">✺ ${escapeHtml(vw.endingSummary || "The End")}</div>
      <button id="again">Play again</button>`;
    $("again").onclick = newSession;
    return;
  }

  if (vw.phase === PHASES.SCENE) {
    el.innerHTML =
      `<div class="choices">` +
      vw.choices.map((c) => `<button class="choice" data-id="${c.id}">▸ ${escapeHtml(c.label)}</button>`).join("") +
      `</div>`;
    el.querySelectorAll(".choice").forEach((b) => (b.onclick = () => act(() => choose(session, b.dataset.id))));
    return;
  }

  if (vw.phase === PHASES.WRITE_IN) {
    const w = vw.pending.writeIn || {};
    el.innerHTML = `
      <div class="prompt">✎ ${escapeHtml(w.prompt || "Write your answer:")}</div>
      ${w.rubricHint ? `<div class="dim small">Hint: ${escapeHtml(w.rubricHint)}</div>` : ""}
      <textarea id="answer" rows="3" placeholder="Type in English..."></textarea>
      <button id="send">Submit answer</button>`;
    $("send").onclick = () => act(() => submitWriteIn(session, $("answer").value));
    $("answer").focus();
    return;
  }

  if (vw.phase === PHASES.CHECK) {
    const dcInfo =
      vw.lastSpellInfo && vw.lastSpellInfo.type === "revealDC" && vw.lastSpellInfo.dc != null
        ? ` <span class="dim">(target DC ${vw.lastSpellInfo.dc})</span>`
        : "";
    el.innerHTML = `<div class="prompt">🎲 Time to roll.${dcInfo} English bonus: <b>+${session.pendingBonus}</b></div>
      <button id="roll">Roll the dice</button>`;
    $("roll").onclick = () => act(() => resolveCheck(session));
    return;
  }

  if (vw.phase === PHASES.FAILED) {
    const r = vw.lastRoll;
    el.innerHTML = `<div class="fail">✗ Rolled ${r.base} + ${r.bonus} = ${r.total} vs DC ${r.dc} — not enough.</div>
      <div class="choices">
        ${vw.hud.inspiration > 0 ? `<button id="reroll">✦ Reroll (spend 1 Inspiration)</button>` : ""}
        <button id="another">Choose a different path</button>
      </div>`;
    if (vw.hud.inspiration > 0) $("reroll").onclick = () => act(() => reroll(session));
    $("another").onclick = () => act(() => pickAnother(session));
    return;
  }

  el.innerHTML = "";
}

function onCastSpell(spellId) {
  const sp = session.spells.find((x) => x.id === spellId);
  if (!sp || sp.used) return;
  if (sp.upgradeBeat) {
    $("interaction").innerHTML = `
      <div class="prompt">${escapeHtml(sp.icon || "✦")} Cast <b>${escapeHtml(sp.name)}</b></div>
      <div class="dim small">${escapeHtml(sp.upgradeBeat.writePrompt || "")} (Optional &mdash; good English upgrades the effect.)</div>
      <textarea id="spellanswer" rows="2" placeholder="Type in English (or leave blank)..."></textarea>
      <button id="castnow">Cast spell</button>`;
    $("castnow").onclick = () => act(() => castSpell(session, spellId, $("spellanswer").value));
    $("spellanswer").focus();
  } else {
    act(() => castSpell(session, spellId));
  }
}

function renderFeedback(vw) {
  const g = vw.lastGrade;
  if (!g) {
    $("feedback").innerHTML = "";
    return;
  }
  const used = g.distinctUsed.length ? g.distinctUsed.map(escapeHtml).join(", ") : "—";
  const mistakes = g.mistakes.length
    ? `<ul>${g.mistakes.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>`
    : `<span class="ok">clean!</span>`;
  const pct = Math.round(g.qualityScore * 100);
  $("feedback").innerHTML = `
    <h3>Feedback ${g.stub ? '<span class="dim small">(stub grader)</span>' : ""}</h3>
    <div>Quality <b>${pct}%</b> &middot; Target language used: <b>${used}</b> &middot; Roll bonus <b>+${g.rollBonus}</b></div>
    <div>Notes: ${mistakes}</div>
    ${g.corrected ? `<div class="dim small">Suggested: ${escapeHtml(g.corrected)}</div>` : ""}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("difficulty").onchange = newSession;
$("hints").onchange = newSession;
$("restart").onclick = newSession;

boot();
