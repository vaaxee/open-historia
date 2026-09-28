import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import {
  VERDICT_INSTRUCTION,
  buildProposalThread,
  describeVerdictForTurn,
  diplomaticOrders,
  enforceProposalVerdicts,
  parseVerdict,
} from "./playerDiplomacy.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const world = {
  polityOverrides: {
    Finland: { name: "Finland", aliases: [] },
    Lithuania: { name: "Lithuania", aliases: [] },
    "Soviet Union": { name: "Soviet Union", aliases: [] },
    France: { name: "France", aliases: [] },
  },
};

test("the orders that put something to one other polity are found; wars and vague orders are not", () => {
  const orders = diplomaticOrders({
    player: "Soviet Union",
    world,
    actions: [
      { id: "a1", status: "planned", kind: "action", title: "Proposer à la Finlande d'échanger l'isthme de Carélie contre des céréales." },
      { id: "a2", status: "planned", kind: "action", title: "Déclarer la guerre à la Lituanie." },
      { id: "a3", status: "planned", kind: "chat", title: "Sécuriser un accord avec la France", invitees: ["France"], chatStarter: "Nous proposons un pacte d'assistance mutuelle." },
      { id: "a4", status: "planned", kind: "action", title: "Négocier avec la France et la Finlande" },
      { id: "a5", status: "resolved", kind: "chat", title: "Old", invitees: ["France"] },
      { id: "a6", status: "planned", kind: "action", title: "Construire des usines" },
    ],
  });
  assert.deepEqual(orders.map((order) => [order.action.id, order.counterpart, order.message]), [
    ["a1", "Finland", "Proposer à la Finlande d'échanger l'isthme de Carélie contre des céréales."],
    ["a3", "France", "Nous proposons un pacte d'assistance mutuelle."],
  ]);
});

test("the counterpart's verdict is read from its hidden line and never shown", () => {
  assert.deepEqual(parseVerdict("Nous refusons fermement.\nVERDICT: REFUSE"), { verdict: "REFUSE", reply: "Nous refusons fermement." });
  assert.deepEqual(parseVerdict("**VERDICT: ACCEPT**\nNous acceptons."), { verdict: "ACCEPT", reply: "Nous acceptons." });
  assert.deepEqual(parseVerdict("Peut-être, à d'autres conditions."), { verdict: "", reply: "Peut-être, à d'autres conditions." });
  assert.match(VERDICT_INSTRUCTION, /VERDICT: ACCEPT .* VERDICT: REFUSE, or VERDICT: COUNTER/);
});

test("the thread starts with the player's message, then the counterpart answers", () => {
  const thread = buildProposalThread({
    action: { id: "a1", title: "Carélie contre céréales" },
    countries: [{ code: "Finland", name: "Finland" }],
    player: "Soviet Union",
    message: "Nous proposons d'échanger l'isthme de Carélie contre des céréales.",
    answer: { reply: "La Finlande ne cède pas son territoire.", memorySummary: "Finland refused.", reaction: "🙅" },
    date: "1936-01-01",
  });
  assert.equal(thread.messages[0].role, "user");
  assert.equal(thread.messages[0].speaker, "Soviet Union");
  assert.equal(thread.messages[0].text, "Nous proposons d'échanger l'isthme de Carélie contre des céréales.");
  assert.equal(thread.messages[1].role, "leader");
  assert.equal(thread.messages[1].speaker, "Finland");
  assert.equal(thread.messages[1].text, "La Finlande ne cède pas son territoire.");
  assert.equal(thread.messages[1].memorySummary, "Finland refused.");
  assert.ok(!thread.messages.some((message) => /VERDICT/.test(message.text)), "the instruction and the verdict stay hidden");
  assert.match(describeVerdictForTurn({ counterpart: "Finland", verdict: "REFUSE", title: "Carélie contre céréales" }), /put to Finland, who REFUSED it/);
});

test("an agreement stands only if the counterpart accepted; a chat restating the proposal is not opened", () => {
  const candidate = {
    events: [{ title: "Finlande", impacts: { createdChats: [{ countries: [{ code: "Finland", name: "Finland" }], speaker: "Finland", openingMessage: "Nous proposons…" }, { countries: ["France", "Finland"], speaker: "France" }] } }],
    agreementUpdates: [
      { id: "karelia", op: "start", type: "peace_settlement", parties: ["Soviet Union", "Finland"], title: "Karelia for grain" },
      { id: "franco", op: "start", type: "mutual_defense", parties: ["Soviet Union", "France"], title: "Franco-Soviet pact" },
    ],
  };
  const notes = enforceProposalVerdicts(candidate, [
    { counterpart: "Finland", verdict: "REFUSE" },
    { counterpart: "France", verdict: "ACCEPT" },
  ], "Soviet Union");
  assert.deepEqual(candidate.agreementUpdates.map((entry) => entry.id), ["franco"], "France accepted, Finland refused");
  assert.equal(candidate.events[0].impacts.createdChats.length, 1, "the two-country chat stays");
  assert.match(notes.join(" "), /"Karelia for grain" between Soviet Union and Finland was not applied: the other side did not accept/);
  const text = { agreementUpdates: "karelia~start~peace_settlement~Soviet Union,Finland~Karelia~grain\nother~start~trade_economic~France,Finland~Trade~" };
  enforceProposalVerdicts(text, [{ counterpart: "Finland", verdict: "COUNTER" }], "Soviet Union");
  assert.equal(text.agreementUpdates, "other~start~trade_economic~France,Finland~Trade~", "a counter-offer is not an acceptance; others' agreements stay");
});

test("wired: proposals are put before the prompt is built, answered with Realpolitik, and enforced before validation", () => {
  const gameplay = fs.readFileSync(path.join(here, "gameplay.js"), "utf8");
  const put = gameplay.indexOf("const proposals = await putPlayerProposals(bundle, { signal });");
  // The told orders ride in the prompt's bundle (with the engine's battles, phase 7.5).
  const variables = gameplay.indexOf("const variables = await buildTemplateVariables({ ...bundle, ...(proposals.actions ? { actions: proposals.actions } : {}), engineCombat }, {");
  assert.ok(put > 0 && variables > put);
  const helper = gameplay.slice(gameplay.indexOf("const putPlayerProposals = async"), gameplay.indexOf("const putPlayerProposals = async") + 3000);
  assert.match(helper, /await sendDiplomaticMessageOnceOff\(\{\s*playerMessage: `\$\{message\}\\n\\n\$\{VERDICT_INSTRUCTION\}`/);
  assert.match(helper, /bundle\.chats = \[\.\.\.normalizeArray\(bundle\.chats\), \.\.\.threads\];/);
  const enforce = gameplay.indexOf("enforceProposalVerdicts(candidate, context.proposalVerdicts ?? []");
  const validate = gameplay.indexOf("const worldChangeError = await validateGeneratedWorldChanges(candidate, bundle.world, {", enforce);
  assert.ok(enforce > 0 && validate > enforce, "a refused treaty is out before the war rules read the answer");
  const main = fs.readFileSync(path.join(here, "main.jsx"), "utf8");
  const prompt = main.slice(main.indexOf("export async function buildDiplomaticSystemPrompt"), main.indexOf("export async function sendDiplomaticMessageOnceOff"));
  assert.match(prompt, /return withRealpolitik\(prompt, \{/);
  assert.match(main, /export async function sendDiplomaticMessageOnceOff[\s\S]{0,200}buildDiplomaticSystemPrompt\(participantNames, playerCountry, speakingAs/);
});
