// Lightweight campaign validator: structure + referential integrity.
// A formal JSON Schema (for Ollama structured-output generation) arrives with
// task #9; this hand-rolled check keeps us dependency-free for now and catches
// the mistakes the AI generator will most often make (dangling node links, etc).

export function validateCampaign(c) {
  const errors = [];
  const req = (cond, msg) => {
    if (!cond) errors.push(msg);
  };

  if (!c || typeof c !== "object") {
    return { ok: false, errors: ["campaign must be an object"] };
  }

  req(typeof c.id === "string" && c.id, "id is required");
  req(typeof c.title === "string" && c.title, "title is required");
  req(typeof c.startNodeId === "string" && c.startNodeId, "startNodeId is required");
  req(c.nodes && typeof c.nodes === "object", "nodes map is required");
  req(Array.isArray(c.sections), "sections array is required");

  const sectionIds = new Set((c.sections || []).map((s) => s.id));
  (c.sections || []).forEach((s, i) => {
    req(typeof s.id === "string" && s.id, `section[${i}].id required`);
    req(Array.isArray(s.targetLanguageBank), `section[${i}].targetLanguageBank must be an array`);
  });

  const nodeIds = new Set(Object.keys(c.nodes || {}));
  req(nodeIds.has(c.startNodeId), `startNodeId "${c.startNodeId}" not found in nodes`);

  const refOk = (id) => id == null || nodeIds.has(id);
  for (const [nid, node] of Object.entries(c.nodes || {})) {
    req(node.sectionId == null || sectionIds.has(node.sectionId), `node ${nid}: unknown sectionId "${node.sectionId}"`);
    req(refOk(node.escapeNodeId), `node ${nid}: escapeNodeId "${node.escapeNodeId}" not found`);
    if (!node.isEnding) {
      req(Array.isArray(node.choices) && node.choices.length > 0, `node ${nid}: non-ending node needs choices`);
    }
    (node.choices || []).forEach((ch, i) => {
      req(typeof ch.id === "string" && ch.id, `node ${nid} choice[${i}].id required`);
      if (ch.hiddenTrap) req(refOk(ch.hiddenTrap.consequenceNodeId), `node ${nid} choice ${ch.id}: trap consequenceNodeId not found`);
      if (ch.onSuccess) req(refOk(ch.onSuccess.nextNodeId), `node ${nid} choice ${ch.id}: onSuccess.nextNodeId not found`);
      if (ch.onFailure) req(refOk(ch.onFailure.nextNodeId), `node ${nid} choice ${ch.id}: onFailure.nextNodeId not found`);
    });
  }

  const spellIds = new Set();
  (c.spellPool || []).forEach((sp, i) => {
    req(typeof sp.id === "string" && sp.id, `spellPool[${i}].id required`);
    req(!spellIds.has(sp.id), `duplicate spell id "${sp.id}"`);
    spellIds.add(sp.id);
    req(sp.baseEffect && typeof sp.baseEffect.type === "string", `spell ${sp.id}: baseEffect.type required`);
  });

  return { ok: errors.length === 0, errors };
}
