// Headless save/restore round-trip test. Plays a scripted sequence on the
// sample campaign, serializes the session, restores it into a new session,
// asserts every field matches, and continues playing from the resume point.
import { readFileSync } from "node:fs";
import {
  createSession,
  view,
  choose,
  submitWriteIn,
  resolveCheck,
  PHASES,
  serializeSession,
  restoreSession,
} from "../src/core/engine.js";

const campaign = JSON.parse(
  readFileSync(new URL("../campaigns/sample-first-morning.json", import.meta.url), "utf8")
);

let failures = 0;
const check = (label, cond) => { console.log(`${cond ? "  ok  " : " FAIL "} ${label}`); if (!cond) failures++; };

const rng = () => 0.97; // forces high rolls so checks pass deterministically
const s = createSession(campaign, { rng, hintsOn: true });

choose(s, "c_coffee"); // opens the write-in beat
await submitWriteIn(s, "Hello, I would like a coffee, please.");
await resolveCheck(s);

// Snapshot mid-campaign
const saved = serializeSession(s);
check("saved snapshot has campaignId", saved.campaignId === campaign.id);
check("saved snapshot has nodeId", typeof saved.nodeId === "string" && saved.nodeId.length);
check("saved snapshot has transcript", Array.isArray(saved.transcript) && saved.transcript.length > 0);
check("saved snapshot has phase", typeof saved.phase === "string");
check("saved snapshot tracks points", saved.points > 0);

// Restore into a fresh session, with the SAME rng so future rolls are predictable
const restored = restoreSession(campaign, saved, { rng, grade: s.grade });
check("restored points match", restored.points === s.points);
check("restored progress match", restored.progressPct === s.progressPct);
check("restored inspiration match", restored.inspiration === s.inspiration);
check("restored nodeId match", restored.nodeId === s.nodeId);
check("restored phase match", restored.phase === s.phase);
check("restored difficulty match", restored.difficulty === s.difficulty);
check("restored hintsOn match", restored.hintsOn === s.hintsOn);
check("restored spell-used flags match", restored.spells.every((sp, i) => sp.used === s.spells[i].used));
check("restored transcript length matches", restored.transcript.length === s.transcript.length);

// Continue playing from the restored session and confirm it still works
const v1 = choose(restored, "c_photo"); // hidden trap
check("continued play from restore reached police node", v1.node.id === "n_police");

// Mismatched-campaign rejection
let threw = false;
try { restoreSession({ ...campaign, id: "different-id" }, saved); } catch { threw = true; }
check("restore rejects different campaignId", threw);

// Missing-node rejection (simulates a campaign edit that removed the saved node)
threw = false;
try {
  const trimmed = { ...campaign, nodes: { ...campaign.nodes } };
  delete trimmed.nodes[saved.nodeId];
  restoreSession(trimmed, saved);
} catch { threw = true; }
check("restore rejects missing node", threw);

console.log(`\n${failures === 0 ? "ALL SAVE/RESUME CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);

async function submitWriteInLater(s, text) { return submitWriteIn(s, text); }
async function resolveCheckLater(s) { return resolveCheck(s); }
