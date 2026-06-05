// Live generation test: ask qwen2.5:7b for a campaign from a brief, compile it,
// validate it. Proves real AI generation end to end. Run: node scripts/gen-test.js
import { readFileSync, writeFileSync } from "node:fs";
import { makeClient, generateStorySpec } from "../src/core/ai.js";
import { compileCampaign } from "../src/core/compile.js";
import { validateCampaign } from "../src/core/schema.js";

const password = readFileSync("C:/GarrakGame/secret.local.txt", "utf8").trim();
const client = makeClient({ baseUrl: "https://10.0.0.54:11435", model: "qwen2.5:7b", password });

const brief = {
  idea: "A first trip to a Japanese convenience store (konbini) to buy lunch and ask the clerk for help",
  cefrLevel: "A1",
  targetLanguage: "greetings, 'I would like', 'how much is...', numbers, 'thank you'",
  interests: "anime, snacks",
  length: "one-shot",
};

console.log("Generating with qwen2.5:7b ...");
const t0 = Date.now();
try {
  const spec = await generateStorySpec(client, brief);
  const campaign = compileCampaign(spec, { brief });
  const v = validateCampaign(campaign);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nGenerated + compiled in ${secs}s`);
  console.log("title    :", campaign.title);
  console.log("level    :", campaign.cefrLevel, "| est min:", campaign.estimatedMinutes);
  console.log("sections :", campaign.sections.map((s) => `${s.title} [${s.targetLanguageBank.length} words]`).join("  |  "));
  console.log("nodes    :", Object.keys(campaign.nodes).length, "| spells:", campaign.spellPool.map((s) => s.name).join(", "));
  const bank0 = campaign.sections[0].targetLanguageBank.slice(0, 4).map((t) => `${t.text}=${t.l1Hint}`).join("; ");
  console.log("bank[0]  :", bank0);
  console.log("validation:", v.ok ? "OK ✅" : "FAILED -> " + v.errors.join("; "));

  writeFileSync("C:/GarrakGame/campaigns/generated-test.json", JSON.stringify(campaign, null, 2));
  console.log("\nwrote campaigns/generated-test.json");
  process.exit(v.ok ? 0 : 1);
} catch (e) {
  console.error("generation failed:", e.message);
  process.exit(2);
}
