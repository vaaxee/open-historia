// The player's diplomatic orders are said to the other side, who answers.
//
// The bug (reported after game F): an order such as "secure an agreement with X"
// came back as a chat in which X spoke first — often in the player's own words —
// and then waited for the player: X never answered the proposal, and the turn
// could write the agreement anyway. Now, at the start of the turn, each such
// order opens a real thread: the player's message goes to X, X answers through
// the ordinary diplomatic prompt (with its [Realpolitik] block) and gives a
// verdict on a hidden line — ACCEPT, REFUSE or COUNTER. The turn is told the
// verdict; an agreement between the player and X is applied only if X accepted,
// and a chat in which X would restate the player's proposal is not opened.

import { mentionedPolities } from "../../runtime/polityExonyms.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const key = (value) => clean(value).normalize("NFD").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = (value) => (Array.isArray(value) ? value : []);

// A proposal, a demand or a negotiation put to someone, in several languages.
const PROPOSAL = /(accord|agreement|trait[ée]|treaty|pacte|pact|alliance|propos|offer|offrir|n[ée]goci|negotiat|s[ée]curiser|secure|conclu|conclude|[ée]chang|exchange|exiger|demand|garanti|guarantee|verhandl|abkommen|vertrag|acuerdo|tratado|negocia|accordo|trattato)/i;
// A declaration of war is an order of its own (playerWarOrders.js), not a proposal.
const WAR = /(d[ée]clar\w*\s+(?:la\s+)?guerre|declar\w*\s+(?:of\s+)?war|kriegserkl|declara\w*\s+(?:la\s+)?guerra|dichiara\w*\s+(?:la\s+)?guerra)/i;

export const VERDICTS = Object.freeze(["ACCEPT", "REFUSE", "COUNTER"]);

// The planned orders that put something to one other polity: chat orders with
// their invitees, and orders that propose, demand or negotiate with exactly one
// polity they name. [{ action, counterpart, message }]
export const diplomaticOrders = ({ actions, world, player }) => {
  const out = [];
  for (const action of list(actions)) {
    if (clean(action?.status || "planned") !== "planned") continue;
    const text = `${clean(action?.title)} ${clean(action?.text)}`;
    if (WAR.test(text)) continue;
    const isChat = clean(action?.kind) === "chat";
    if (!isChat && !PROPOSAL.test(text)) continue;
    const invited = list(action?.invitees)
      .map((entry) => clean(typeof entry === "string" ? entry : entry?.name ?? entry?.code))
      .filter((name) => name && key(name) !== key(player));
    const named = invited.length ? invited : mentionedPolities(text, world).filter((name) => key(name) !== key(player));
    if (named.length !== 1) continue;
    out.push({ action, counterpart: named[0], message: clean(action?.chatStarter) || clean(action?.title) || text });
  }
  return out;
};

// What the counterpart is asked on top of the player's message (never stored in
// the thread): a verdict on a hidden line.
export const VERDICT_INSTRUCTION = "[From the game, not from the player: this is a formal proposal from their government. Answer it in character. Then, on its own line before anything hidden, write exactly one of: VERDICT: ACCEPT (your government agrees to the proposal as stated), VERDICT: REFUSE, or VERDICT: COUNTER (you agree only on other terms, which your reply states).]";

// The verdict line out of a reply: { verdict, reply } — verdict "" when none.
export const parseVerdict = (reply) => {
  const text = String(reply ?? "");
  const match = text.match(/^\s*\**\s*VERDICT\s*:\s*\**\s*(ACCEPT|REFUSE|COUNTER)\b.*$/im);
  if (!match) return { verdict: "", reply: text.trim() };
  return { verdict: match[1].toUpperCase(), reply: `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`.trim() };
};

// The thread: the player's message, then the counterpart's answer. `countries`
// are the resolved participants ({ code, name }); the player is implicit.
export const buildProposalThread = ({ action, countries, player, message, answer, date = "" }) => ({
  id: `chat-proposal-${clean(action?.id) || Date.now()}`,
  title: clean(action?.title) || `Proposal to ${countries.map((country) => country.name).join(", ")}`,
  countries,
  source: "action",
  status: "open",
  linkedEventId: "",
  messages: [
    { role: "user", speaker: player, text: message, time: date },
    ...(clean(answer?.reply) ? [{
      role: "leader",
      speaker: countries[0]?.name ?? "",
      code: countries[0]?.code ?? "",
      text: clean(answer.reply),
      time: date,
      ...(clean(answer?.memorySummary) ? { memorySummary: clean(answer.memorySummary) } : {}),
      ...(answer?.reaction ? { reaction: answer.reaction } : {}),
    }] : []),
  ],
});

// What the turn is told about the order (appended to it for this turn only).
export const describeVerdictForTurn = ({ counterpart, verdict, title }) => {
  const outcome = verdict === "ACCEPT" ? "ACCEPTED it"
    : verdict === "REFUSE" ? "REFUSED it"
      : verdict === "COUNTER" ? "answered with a counter-proposal (not an acceptance)"
        : "gave no clear answer (not an acceptance)";
  return `[Engine: this proposal was put to ${counterpart}, who ${outcome} — see the chat "${title}". Only an acceptance makes an agreement; do not open another chat restating it.]`;
};

// The turn's answer against the verdicts: an agreement between the player and a
// counterpart who did not accept is removed, and so is a chat that would have
// the counterpart restate the proposal. Returns the receipt lines.
export const enforceProposalVerdicts = (candidate, verdicts, player) => {
  const notes = [];
  if (!candidate || !list(verdicts).length) return notes;
  const notAccepted = list(verdicts).filter((entry) => entry.verdict !== "ACCEPT").map((entry) => entry.counterpart);
  const handled = new Map(list(verdicts).map((entry) => [key(entry.counterpart), entry]));
  const involves = (parties, counterpart) => {
    const keys = new Set(list(parties).map(key));
    return keys.has(key(player)) && keys.has(key(counterpart));
  };
  // Agreements (objects, or "id~op~type~parties~…" lines).
  const agreements = candidate.agreementUpdates;
  const dropAgreement = (op, parties) => clean(op).toLowerCase() === "start"
    && notAccepted.some((counterpart) => involves(parties, counterpart));
  if (Array.isArray(agreements)) {
    candidate.agreementUpdates = agreements.filter((entry) => {
      const drop = typeof entry === "object" && dropAgreement(entry?.op, entry?.parties);
      if (drop) notes.push(`The agreement "${clean(entry?.title) || clean(entry?.id)}" between ${list(entry?.parties).join(" and ")} was not applied: the other side did not accept the proposal. It did NOT come into force.`);
      return !drop;
    });
  } else if (typeof agreements === "string") {
    candidate.agreementUpdates = agreements.split(/\r?\n/).filter((line) => {
      const [id, op, , parties] = line.split("~");
      const drop = dropAgreement(op, String(parties ?? "").split(","));
      if (drop) notes.push(`The agreement "${clean(id)}" was not applied: the other side did not accept the proposal. It did NOT come into force.`);
      return !drop;
    }).join("\n");
  }
  // A chat the counterpart would open to restate the proposal.
  const restates = (chat) => {
    const names = list(chat?.countries).map((entry) => key(typeof entry === "string" ? entry : entry?.name ?? entry?.code));
    return names.length === 1 && handled.has(names[0]);
  };
  for (const event of list(candidate.events)) {
    const chats = event?.impacts?.createdChats;
    if (!Array.isArray(chats)) continue;
    const kept = chats.filter((chat) => !restates(chat));
    if (kept.length !== chats.length) notes.push(`A chat with ${[...handled.values()].map((entry) => entry.counterpart).join(", ")} restating the player's proposal was not opened: the proposal was already put to them, and they answered.`);
    event.impacts.createdChats = kept;
  }
  if (Array.isArray(candidate.diplomaticOutreach)) candidate.diplomaticOutreach = candidate.diplomaticOutreach.filter((chat) => !restates(chat));
  return notes;
};
