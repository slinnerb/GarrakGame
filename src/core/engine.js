// Garak :: Game (Wrench & Ram) — core engine. Pure logic, no UI, no Electron, no network.
// The UI (and later a remote client) drive this through these functions and
// render whatever view() returns. Keeping it pure is what lets a future
// invite-code client run the exact same game.

import { rollCheck, DIFFICULTIES } from "./dice.js";
import { stubGrade } from "./grader.js";

export const PHASES = {
  SCENE: "scene", // showing a node + its choices
  WRITE_IN: "writeIn", // awaiting the player's written answer
  CHECK: "check", // awaiting a dice roll
  FAILED: "failed", // a roll failed; reroll or pick another path
  ENDED: "ended", // reached an ending node
};

export function createSession(campaign, opts = {}) {
  const difficulty = opts.difficulty || campaign.defaultDifficulty || "adventurer";
  const loadoutIds =
    opts.loadout ||
    (campaign.spellPool || []).slice(0, campaign.loadoutSize || 3).map((s) => s.id);
  const spells = (campaign.spellPool || [])
    .filter((s) => loadoutIds.includes(s.id))
    .map((s) => ({ ...s, used: false }));

  return {
    campaign,
    difficulty,
    hintsOn: !!opts.hintsOn,
    rng: opts.rng || Math.random,
    grade: opts.grade || stubGrade, // injectable grader (real Gemma later)
    nodeId: campaign.startNodeId,
    phase: PHASES.SCENE,
    points: 0,
    progressPct: 0,
    inspiration: 0,
    spells,
    pendingChoiceId: null,
    pendingBonus: 0,
    lastGrade: null,
    lastRoll: null,
    lastSpellInfo: null,
    transcript: [],
  };
}

function node(s) {
  return s.campaign.nodes[s.nodeId];
}
function section(s) {
  const n = node(s);
  return (s.campaign.sections || []).find((x) => x.id === n.sectionId) || null;
}
function choiceById(s, id) {
  return (node(s).choices || []).find((c) => c.id === id) || null;
}
function log(s, entry) {
  s.transcript.push(entry);
}

export function view(s) {
  const n = node(s);
  const sec = section(s);
  return {
    phase: s.phase,
    node: {
      id: n.id,
      text: n.text,
      ascii: n.ascii || null,
      clue: n.clue || null,
      isConsequence: !!n.isConsequence,
    },
    section: sec ? { id: sec.id, title: sec.title } : null,
    bank: sec
      ? sec.targetLanguageBank.map((t) => ({
          text: t.text,
          type: t.type,
          hint: s.hintsOn ? t.l1Hint || null : null,
        }))
      : [],
    choices:
      s.phase === PHASES.SCENE
        ? (n.choices || []).map((c) => ({ id: c.id, label: c.label }))
        : [],
    pending: s.pendingChoiceId
      ? { choiceId: s.pendingChoiceId, writeIn: choiceById(s, s.pendingChoiceId)?.writeIn || null }
      : null,
    spells: s.spells.map((sp) => ({
      id: sp.id,
      name: sp.name,
      flavor: sp.flavor,
      icon: sp.icon || null,
      used: sp.used,
    })),
    hud: {
      points: s.points,
      progressPct: Math.round(s.progressPct),
      inspiration: s.inspiration,
      difficulty: s.difficulty,
    },
    lastGrade: s.lastGrade,
    lastRoll: s.lastRoll,
    lastSpellInfo: s.lastSpellInfo,
    ended: s.phase === PHASES.ENDED,
    endingSummary: n.isEnding ? n.endingSummary || null : null,
  };
}

function applyGrade(s, grade) {
  s.lastGrade = grade;
  s.progressPct += Math.round(grade.qualityScore * 50); // a strong answer ~ half a bar
  while (s.progressPct >= 100) {
    s.progressPct -= 100;
    s.inspiration += 1;
  }
  s.points += Math.round(grade.qualityScore * 20) + grade.distinctCount * 2;
  s.pendingBonus = grade.rollBonus || 0;
}

export function choose(s, choiceId) {
  if (s.phase !== PHASES.SCENE) throw new Error(`choose() not allowed in phase ${s.phase}`);
  const c = choiceById(s, choiceId);
  if (!c) throw new Error(`unknown choice ${choiceId}`);
  log(s, { type: "choice", nodeId: s.nodeId, choiceId, label: c.label });
  s.pendingChoiceId = choiceId;
  s.pendingBonus = 0;
  s.lastSpellInfo = null;

  if (c.hiddenTrap) {
    // a hidden-fail trap fires the moment this path is taken
    log(s, { type: "trap", clue: c.hiddenTrap.clue || null });
    return advanceTo(s, c.hiddenTrap.consequenceNodeId);
  }
  if (c.writeIn) {
    s.phase = PHASES.WRITE_IN;
    return view(s);
  }
  if (c.skillCheck) {
    s.phase = PHASES.CHECK;
    return view(s);
  }
  return resolveSuccess(s, c); // plain narrative choice
}

export function submitWriteIn(s, text) {
  if (s.phase !== PHASES.WRITE_IN) throw new Error(`submitWriteIn() not allowed in phase ${s.phase}`);
  const c = choiceById(s, s.pendingChoiceId);
  const sec = section(s);
  const grade = s.grade(text, sec ? sec.targetLanguageBank : [], {
    maxGrammarBonus: DIFFICULTIES[s.difficulty]?.maxGrammarBonus ?? 4,
    expectedTargets: c.writeIn?.expectedTargets,
  });
  log(s, { type: "writeIn", text, grade });
  applyGrade(s, grade);
  if (c.skillCheck) {
    s.phase = PHASES.CHECK;
    return view(s);
  }
  return resolveSuccess(s, c); // write-in-only beat counts as success
}

export function resolveCheck(s) {
  if (s.phase !== PHASES.CHECK) throw new Error(`resolveCheck() not allowed in phase ${s.phase}`);
  const c = choiceById(s, s.pendingChoiceId);
  const dc = c.skillCheck.baseDC;
  const roll = rollCheck(s.difficulty, { dc, bonus: s.pendingBonus, rng: s.rng });
  s.lastRoll = roll;
  log(s, { type: "roll", roll });
  if (roll.success) return resolveSuccess(s, c);
  s.phase = PHASES.FAILED;
  return view(s);
}

export function reroll(s) {
  if (s.phase !== PHASES.FAILED) throw new Error(`reroll() not allowed in phase ${s.phase}`);
  if (s.inspiration <= 0) throw new Error("no inspiration to reroll");
  s.inspiration -= 1;
  log(s, { type: "reroll" });
  s.phase = PHASES.CHECK;
  return resolveCheck(s);
}

export function pickAnother(s) {
  if (s.phase !== PHASES.FAILED) throw new Error(`pickAnother() not allowed in phase ${s.phase}`);
  const c = choiceById(s, s.pendingChoiceId);
  if (c.onFailure && c.onFailure.nextNodeId) return resolveFailure(s, c);
  s.phase = PHASES.SCENE; // no failure branch: return to the scene to choose again
  s.pendingChoiceId = null;
  return view(s);
}

// Summarize the session for the end-of-session recap. Pure read - safe to call
// anytime (handy for "preview" mid-session too). Aggregates everything the
// transcript already records: target words used vs missed, write-in quality,
// mistakes to review, roll history, and a per-section breakdown.
export function recap(s) {
  const writeIns = s.transcript.filter((t) => t.type === "writeIn" || t.type === "spellWriteIn");
  const allBank = (s.campaign.sections || []).flatMap((sec) => sec.targetLanguageBank.map((b) => ({ ...b, sectionId: sec.id })));
  const usedSet = new Set();
  for (const w of writeIns) for (const u of (w.grade?.distinctUsed || [])) usedSet.add(u.toLowerCase());
  const mastered = allBank.filter((b) => usedSet.has(b.text.toLowerCase()));
  const missed = allBank.filter((b) => !usedSet.has(b.text.toLowerCase()));
  const masteryPct = allBank.length ? Math.round((mastered.length / allBank.length) * 100) : 0;
  const avgQuality = writeIns.length
    ? Math.round((writeIns.reduce((a, w) => a + (w.grade?.qualityScore || 0), 0) / writeIns.length) * 100)
    : 0;
  const mistakes = writeIns
    .filter((w) => (w.grade?.mistakes || []).length)
    .map((w) => ({ text: w.text, mistakes: w.grade.mistakes, corrected: w.grade.corrected }));
  const rolls = s.transcript.filter((t) => t.type === "roll").map((t) => t.roll);
  const rollWins = rolls.filter((r) => r.success).length;
  const spellsUsed = s.transcript.filter((t) => t.type === "spell").map((t) => t.spellId);
  return {
    title: s.campaign.title,
    cefrLevel: s.campaign.cefrLevel,
    difficulty: s.difficulty,
    hintsOn: s.hintsOn,
    hud: { points: s.points, inspiration: s.inspiration, progressPct: Math.round(s.progressPct) },
    answersGiven: writeIns.length,
    avgQuality,
    masteryPct,
    mastered: mastered.map((b) => ({ text: b.text, l1Hint: b.l1Hint })),
    missed: missed.map((b) => ({ text: b.text, l1Hint: b.l1Hint })),
    mistakes,
    rolls: { total: rolls.length, wins: rollWins },
    spellsUsed,
  };
}

export function castSpell(s, spellId, writeInText) {
  const sp = s.spells.find((x) => x.id === spellId);
  if (!sp) throw new Error(`spell ${spellId} not in loadout`);
  if (sp.used) throw new Error(`spell ${spellId} already used`);

  let upgraded = false;
  if (sp.upgradeBeat && typeof writeInText === "string" && writeInText.trim()) {
    const sec = section(s);
    const grade = s.grade(writeInText, sec ? sec.targetLanguageBank : [], {
      maxGrammarBonus: DIFFICULTIES[s.difficulty]?.maxGrammarBonus ?? 4,
    });
    applyGrade(s, grade);
    upgraded = grade.isHighQuality;
    log(s, { type: "spellWriteIn", text: writeInText, grade });
  }
  sp.used = true;
  log(s, { type: "spell", spellId, upgraded });

  const effect = sp.baseEffect?.type;
  const n = node(s);

  if (effect === "cancelConsequence") {
    const target = n.escapeNodeId;
    if (!target) throw new Error(`no escape target for cancelConsequence at node ${n.id}`);
    if (upgraded) s.points += 15; // cast it well -> a better outcome
    return advanceTo(s, target);
  }
  if (effect === "autoPassCheck") {
    if (s.phase === PHASES.CHECK || s.phase === PHASES.FAILED) {
      return resolveSuccess(s, choiceById(s, s.pendingChoiceId));
    }
  }
  if (effect === "revealDC" || effect === "revealHint") {
    s.lastSpellInfo = {
      type: effect,
      dc: choiceById(s, s.pendingChoiceId)?.skillCheck?.baseDC ?? null,
    };
    return view(s);
  }
  return view(s);
}

function resolveSuccess(s, c) {
  const out = c.onSuccess || {};
  if (typeof out.points === "number") s.points += out.points;
  if (out.text) log(s, { type: "outcome", result: "success", text: out.text });
  return advanceTo(s, out.nextNodeId);
}

function resolveFailure(s, c) {
  const out = c.onFailure || {};
  if (out.text) log(s, { type: "outcome", result: "failure", text: out.text });
  return advanceTo(s, out.nextNodeId);
}

function advanceTo(s, nodeId) {
  if (!nodeId) {
    s.phase = PHASES.ENDED; // dead-end safety
    return view(s);
  }
  s.nodeId = nodeId;
  s.pendingChoiceId = null;
  s.pendingBonus = 0;
  const n = node(s);
  if (n.isEnding) {
    s.phase = PHASES.ENDED;
    log(s, { type: "end", nodeId });
  } else {
    s.phase = PHASES.SCENE;
  }
  return view(s);
}
