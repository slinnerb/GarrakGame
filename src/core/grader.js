// STUB grader - a deterministic heuristic stand-in for the real Ollama + Gemma
// grader. It scores a written answer against a section's Target Language Bank.
// Later (task #9) this is replaced by a schema-constrained call to the local
// model; the engine talks to whatever grader function is injected, so the swap
// is invisible to the rest of the game.

export function stubGrade(text, bank, { maxGrammarBonus = 4, expectedTargets } = {}) {
  const raw = (text || "").trim();
  const lower = raw.toLowerCase();

  const used = (bank || []).filter((item) => {
    const t = String(item.text || "").toLowerCase().trim();
    return t.length > 0 && lower.includes(t);
  });
  const distinctCount = new Set(used.map((u) => u.text.toLowerCase())).size;

  const target = expectedTargets || Math.min(3, Math.max(1, (bank || []).length));
  const coverage = Math.min(1, distinctCount / target);

  // naive grammar / diction heuristics (placeholder for real grading)
  const startsCapital = /^[A-Z]/.test(raw);
  const endsPunct = /[.!?]$/.test(raw);
  const words = raw.split(/\s+/).filter(Boolean);
  const enoughWords = words.length >= 3;

  const mistakes = [];
  if (raw.length === 0) mistakes.push("Write a sentence to answer.");
  if (raw.length > 0 && !startsCapital) mistakes.push("Start your sentence with a capital letter.");
  if (raw.length > 0 && !endsPunct) mistakes.push("End your sentence with . ? or !");
  if (raw.length > 0 && !enoughWords) mistakes.push("Try a full sentence (three words or more).");

  const grammarHeuristic = [startsCapital, endsPunct, enoughWords].filter(Boolean).length / 3;

  const qualityScore = clamp01(0.6 * coverage + 0.4 * grammarHeuristic);
  const rollBonus = Math.round(qualityScore * maxGrammarBonus);
  const isHighQuality = raw.length > 0 && mistakes.length <= 2 && distinctCount >= 1;

  const corrected = raw.length
    ? (startsCapital ? raw : raw.charAt(0).toUpperCase() + raw.slice(1)) + (endsPunct ? "" : ".")
    : "";

  return {
    stub: true,
    qualityScore,
    distinctUsed: used.map((u) => u.text),
    distinctCount,
    mistakes,
    corrected,
    rollBonus,
    isHighQuality,
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
