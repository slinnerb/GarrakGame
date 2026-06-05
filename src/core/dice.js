// Dice / skill-check models. Difficulty changes the probability distribution,
// not the campaign's authored DCs. All models produce an effective d20-scale
// result (1..20) so a campaign's Difficulty Classes stay on one simple scale.
//
// NOTE: a true d100 *display* ("you had a 65% chance") is a later UI add; the
// student-facing difficulty still maps to these distributions under the hood.

export function randInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export const DIFFICULTIES = {
  story: { label: "Story", maxGrammarBonus: 6, blurb: "Forgiving: low rolls are softened." },
  adventurer: { label: "Adventurer", maxGrammarBonus: 4, blurb: "Straight d20 vs the difficulty." },
  challenge: { label: "Challenge", maxGrammarBonus: 2, blurb: "Swingy: the dice show no mercy." },
};

// Returns { base, total, dc, bonus, success, crit, model }
// crit is "success" (natural 20), "fail" (natural 1), or null.
export function rollCheck(model, { dc, bonus = 0, rng = Math.random }) {
  let base;
  if (model === "story") {
    // advantage: best of two d20, with crit-fail dampening
    base = Math.max(randInt(rng, 1, 20), randInt(rng, 1, 20));
    if (base <= 3) base += 3;
  } else if (model === "challenge") {
    // disadvantage: worst of two d20 (harder, swingier)
    base = Math.min(randInt(rng, 1, 20), randInt(rng, 1, 20));
  } else {
    // adventurer: straight d20
    base = randInt(rng, 1, 20);
  }
  const total = base + bonus;
  let crit = null;
  if (base === 20) crit = "success";
  else if (base === 1) crit = "fail";
  const success = crit === "success" ? true : crit === "fail" ? false : total >= dc;
  return { base, total, dc, bonus, success, crit, model };
}
