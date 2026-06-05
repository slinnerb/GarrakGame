// Compiler: turns the AI's loose "story spec" into a strict, link-valid campaign
// (the format the engine + validator expect). Doing the graph wiring here -
// instead of asking the model to emit node ids and cross-links - is what makes
// generation reliable on a small local model: the model only writes prose and
// choices; we guarantee the structure.

const EFFECTS = {
  escape: { type: "cancelConsequence", icon: "[JAIL]", upgrade: true },
  jail: { type: "cancelConsequence", icon: "[JAIL]", upgrade: true },
  foresight: { type: "revealDC", icon: "[EYE]" },
  reveal: { type: "revealDC", icon: "[EYE]" },
  charm: { type: "autoPassCheck", icon: "[TALK]" },
  pass: { type: "autoPassCheck", icon: "[TALK]" },
};

function slug(s, fallback) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || fallback
  );
}

export function compileCampaign(spec, opts = {}) {
  const sections = Array.isArray(spec?.sections) ? spec.sections : [];
  const outSections = sections.map((sec, si) => ({
    id: `s${si + 1}`,
    title: String(sec.title || `Section ${si + 1}`),
    targetLanguageBank: (Array.isArray(sec.targetLanguage) ? sec.targetLanguage : [])
      .map((t) => ({
        text: String(t.text || "").trim(),
        type: ["vocab", "phrase", "grammar"].includes(t.type) ? t.type : "vocab",
        l1Hint: t.l1 ? String(t.l1) : null,
      }))
      .filter((t) => t.text),
  }));
  if (outSections.length === 0) outSections.push({ id: "s1", title: "Story", targetLanguageBank: [] });

  // flatten scenes across sections, in order
  const scenes = [];
  sections.forEach((sec, si) => {
    (Array.isArray(sec.scenes) ? sec.scenes : []).forEach((scene, sj) => scenes.push({ si, sj, scene }));
  });

  const nodes = {};
  const nodeId = (i) => (i < scenes.length ? `n_${scenes[i].si}_${scenes[i].sj}` : "n_end");
  let trapCount = 0;

  scenes.forEach((entry, idx) => {
    const { si, scene } = entry;
    const id = nodeId(idx);
    const next = nodeId(idx + 1);
    const rawChoices = Array.isArray(scene.choices) && scene.choices.length ? scene.choices : [{ label: "Continue" }];
    const choices = [];

    rawChoices.forEach((ch, ci) => {
      const choice = { id: `${id}_c${ci}`, label: String(ch.label || `Option ${ci + 1}`) };
      if (ch.trap && trapCount < 2) {
        trapCount++;
        const consId = `${id}_trap`;
        choice.hiddenTrap = { clue: ch.trap.clue ? String(ch.trap.clue) : null, consequenceNodeId: consId };
        nodes[consId] = {
          id: consId,
          sectionId: `s${si + 1}`,
          isConsequence: true,
          escapeNodeId: next,
          text: ch.trap.text ? String(ch.trap.text) : "Trouble! Someone is upset with you.",
          choices: [
            {
              id: `${consId}_fix`,
              label: "Apologize and explain",
              writeIn: { prompt: ch.trap.fixPrompt ? String(ch.trap.fixPrompt) : "Apologize politely in English.", expectedTargets: 1 },
              skillCheck: { baseDC: 13 },
              onSuccess: { text: "They let you off.", nextNodeId: next, points: 5 },
              onFailure: { text: "It costs you, but you move on.", nextNodeId: next, points: 0 },
            },
          ],
        };
      } else {
        if (ch.write && (ch.write.prompt || ch.write.expect)) {
          choice.writeIn = {
            prompt: String(ch.write.prompt || "Write your answer in English."),
            expectedTargets: Number(ch.write.expect) || 2,
          };
        }
        if (ch.dc != null && !isNaN(Number(ch.dc))) {
          choice.skillCheck = { baseDC: Math.max(6, Math.min(18, Number(ch.dc))) };
          choice.onSuccess = { text: ch.success ? String(ch.success) : "", nextNodeId: next, points: 5 };
          choice.onFailure = { text: ch.failure ? String(ch.failure) : "", nextNodeId: next, points: 0 };
        } else {
          choice.onSuccess = { text: ch.success ? String(ch.success) : "", nextNodeId: next, points: 2 };
        }
      }
      choices.push(choice);
    });

    const node = { id, sectionId: `s${si + 1}`, text: String(scene.text || "..."), choices };
    if (scene.ascii) node.ascii = String(scene.ascii);
    nodes[id] = node;
  });

  nodes["n_end"] = {
    id: "n_end",
    sectionId: outSections[outSections.length - 1].id,
    isEnding: true,
    endingSummary: String(spec?.endingSummary || "You finished the adventure. Well done!"),
    text: String(spec?.endingText || "The adventure comes to a close."),
  };

  let startNodeId = scenes.length ? nodeId(0) : "n_start";
  if (!scenes.length) {
    nodes["n_start"] = {
      id: "n_start",
      sectionId: outSections[0].id,
      text: String(spec?.premise || "..."),
      choices: [{ id: "c0", label: "Begin", onSuccess: { nextNodeId: "n_end", points: 0 } }],
    };
  }

  let spellSpecs = Array.isArray(spec?.spells) ? spec.spells : [];
  if (!spellSpecs.length) spellSpecs = [{ name: "Get Out of Jail Free", flavor: "Escape trouble once.", effect: "escape" }];
  const spellPool = spellSpecs.slice(0, 5).map((sp, i) => {
    const eff = EFFECTS[slug(sp.effect, "")] || EFFECTS.foresight;
    const spell = {
      id: `sp_${slug(sp.name, "spell")}_${i}`,
      name: String(sp.name || `Spell ${i + 1}`),
      icon: eff.icon,
      flavor: String(sp.flavor || ""),
      baseEffect: { type: eff.type, text: String(sp.flavor || "") },
    };
    if (eff.upgrade) {
      spell.upgradeBeat = {
        writePrompt: "Apologize politely and explain in English.",
        upgradedEffectText: "You escape cleanly, with no loss.",
      };
    }
    return spell;
  });

  return {
    schemaVersion: "1.0",
    id: opts.id || `gen-${slug(spec?.title, "campaign")}`,
    title: String(spec?.title || "Generated Campaign"),
    cefrLevel: spec?.cefrLevel || opts?.brief?.cefrLevel || "A1",
    estimatedMinutes: Number(spec?.estimatedMinutes) || 25,
    author: "AI (qwen2.5:7b)",
    studentProfile: { name: opts?.brief?.studentName || "", interests: opts?.brief?.interests ? [String(opts.brief.interests)] : [] },
    premise: String(spec?.premise || ""),
    defaultDifficulty: "adventurer",
    loadoutSize: 3,
    startNodeId,
    sections: outSections,
    spellPool,
    nodes,
  };
}
