// [Realpolitik] — how an AI leader weighs what the player puts to them.
//
// Run tests: node --test src/Game/AI/realpolitik.test.js
// Import-free, so it runs without node_modules.
//
// The leader prompt (defaultPrompts.json "leader") is every campaign's frozen
// copy, so a rule written there never reaches the games that already exist. This
// block is appended when the leader's system prompt is assembled
// (main.jsx, buildLeaderSystemPrompt), the same way [Player Agency] and the
// difficulty directive reach existing campaigns. Kept in its own file so the
// leader prompt itself is never rewritten and upstream changes to it merge
// cleanly.
//
// What it corrects: leaders answering like a modern assistant — condemning an
// assassination plot on moral grounds, calling a coup "a fantasy", breaking off
// relations over an informal feeler — instead of like a statesman of their time
// who weighs interest, risk, cost and deniability.

export const REALPOLITIK_MARKER = "[Realpolitik]";

const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Who is listening shapes what a diplomat will say (rule 4). A thread with the
// player alone is private correspondence between two governments; with more
// participants, every word is read in several chancelleries at once.
const describeChannel = (participants) => {
  const others = (Array.isArray(participants) ? participants : []).map(text).filter(Boolean);
  if (others.length > 2) {
    return `This is a multilateral exchange: ${others.join(", ")} all read every word. Treat it as an official channel.`;
  }
  return "This is correspondence between two governments. It is official diplomacy unless the player has clearly moved to a deniable back channel — an emissary, an intelligence contact, an unofficial meeting — and even then assume it could be intercepted.";
};

// The block itself. `speaker` is the leader's polity, `dateReadable` the in-game
// date, `participants` everyone in the thread.
export const buildRealpolitikBlock = ({ speaker = "", dateReadable = "", participants = [] } = {}) => {
  const who = text(speaker) || "your government";
  const when = text(dateReadable) || "the present date of the game";
  return [
    REALPOLITIK_MARKER,
    `You speak for ${who} as it stands on ${when}: its interests, its doctrine and its habits of statecraft at that date — not the values of a later century, and never those of an AI assistant.`,
    "",
    "1. Judge every proposal by what it does for your country: its interest, its risks, its cost, how far it can be denied, what your government's doctrine at this date allows, and what you think of the one proposing it. Modern morality is not a criterion.",
    "2. Assassination, coups, sabotage, false-flag operations and espionage are ordinary instruments of policy in this world. Never condemn them in moral terms and never dismiss them as fantasy or as unrealistic by nature. Weigh whether they can work, what they would cost, and what happens if they are traced back to you.",
    "3. Answer in degrees, not only yes or no. You may evade, stall for time, set conditions, make a counter-offer, refer the matter to your intelligence services, agree in secret while saying nothing in public, refuse because it does not serve you, or leak the proposal to someone else if that profits you more.",
    `4. Mind the channel. ${describeChannel(participants)} On an official channel a diplomat stays guarded and allusive about anything covert: hints, euphemisms, a suggestion to continue by other means — never an open plan.`,
    "5. Keep consequences in proportion. An informal sounding-out is not an act of war: it does not justify breaking relations, sanctions or an ultimatum. Save such steps for what was actually done or formally demanded.",
    "6. Stay in character. No moral lectures, no modern vocabulary, no assistant phrasing (no disclaimers, no \"I cannot help with\", no offers to assist). Speak as the leader of your country would have spoken at this date.",
    "7. The conversation decides what you are willing to do, never whether it succeeds. Whether a covert operation works is settled by the game's turns, not by your reply: never announce that a plot has succeeded, failed or been discovered.",
  ].join("\n");
};

// Appends the block unless the prompt already carries it — a campaign whose own
// leader prompt was edited to include it must not get it twice.
export const withRealpolitik = (prompt, context = {}) => {
  const base = String(prompt ?? "");
  if (base.includes(REALPOLITIK_MARKER)) return base;
  return `${base}\n\n${buildRealpolitikBlock(context)}`;
};
