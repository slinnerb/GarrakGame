// Headless self-test: validates the sample campaign and plays a scripted route
// (coffee write-in + roll -> photo trap -> escape via the Get Out of Jail Free
// spell -> museum ending). Run: npm run selfcheck
import { readFileSync } from "node:fs";
import {
  createSession,
  view,
  choose,
  submitWriteIn,
  resolveCheck,
  castSpell,
  PHASES,
} from "../src/core/engine.js";
import { validateCampaign } from "../src/core/schema.js";

const campaign = JSON.parse(
  readFileSync(new URL("../campaigns/sample-first-morning.json", import.meta.url), "utf8")
);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "  ok  " : " FAIL "} ${label}`);
  if (!cond) failures++;
}

// 1) validate
const v = validateCampaign(campaign);
check("campaign validates (" + (v.errors.join("; ") || "no errors") + ")", v.ok);

// 2) play a scripted, forced-high-roll session
const rng = () => 0.97; // near-max rolls so checks pass deterministically
const s = createSession(campaign, { rng, hintsOn: true });

let vw = view(s);
check("starts at n_arrive in scene phase", vw.node.id === "n_arrive" && vw.phase === PHASES.SCENE);
check("section bank shows L1 hints when on", vw.bank.length > 0 && vw.bank[0].hint !== null);

vw = choose(s, "c_coffee");
check("ordering coffee opens a write-in", vw.phase === PHASES.WRITE_IN && !!vw.pending.writeIn);

vw = submitWriteIn(s, "Hello, I would like a coffee, please.");
check("good answer detected target language", vw.lastGrade.distinctCount >= 3);
check("good answer earned a roll bonus", vw.lastGrade.rollBonus > 0);
check("write-in moves to the dice check", vw.phase === PHASES.CHECK);

vw = resolveCheck(s);
check("successful roll reaches the square", vw.node.id === "n_square" && vw.phase === PHASES.SCENE);

vw = choose(s, "c_photo");
check("photo path springs the hidden trap (police)", vw.node.id === "n_police" && vw.node.isConsequence);

vw = castSpell(s, "sp_jail", "I'm sorry, I didn't know.");
check("Get Out of Jail Free escapes cleanly", vw.node.id === "n_release_free");
check("spell is now spent", vw.spells.find((x) => x.id === "sp_jail").used === true);

vw = choose(s, "c_go2");
vw = choose(s, "c_finish");
check("reaches the museum ending", vw.ended === true && !!vw.endingSummary);
check("scored some points along the way", vw.hud.points > 0);

console.log("\n--- final HUD ---");
console.log(view(s).hud);
console.log("ending:", view(s).endingSummary);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
