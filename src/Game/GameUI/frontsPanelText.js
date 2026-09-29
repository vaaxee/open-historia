// Test G avec Jev — le panneau Fronts dans la langue du joueur.
//
// Les onglets Air et Mer restaient en anglais (« Air wings », « Free: fighters »,
// « Convoy escort », « Prepare », « Soviet Union sent 2 fleet(s) on blockade in
// sea zone 20228 ») : le traducteur de l'interface ne les voyait pas. Le panneau
// écrit maintenant lui-même ses libellés, et traduit les notes du moteur
// (runtime/hoi/fronts.js, air.js, naval.js), qui restent en anglais pour l'IA.
// Import-free à part les tables de noms.

import { capitalizeFirst, frenchPolityWithArticle, frenchPolityName } from "../../runtime/polityExonyms.js";
import { placeNameFor } from "../../runtime/worldmap/placeNames.js";

const WORDS = {
  en: {
    title: "Fronts", close: "Close", tabs: { land: "Land", air: "Air", sea: "Sea" },
    noArmies: "This game has no armies tracked by the engine.", loading: "Loading…", loadingMap: "Loading the map…",
    openFront: "Open a front", noWar: "You are at war with no one: declare a war first.", enemy: "Enemy",
    statesDrawn: (n) => `${n} state(s) drawn`, openOnLine: "Open on this line", cancel: "Cancel", wholeBorder: "Whole border", drawOnMap: "Draw on the map",
    divisions: (n) => `${n} division(s)`, line: "Line", axis: "Axis", send: "Send", redraw: "Redraw", saveLine: "Save the line", states: (n) => `${n} state(s)`,
    closeFront: "Close the front", noLongerAtWar: "No longer at war: it will close at the next turn.", drawHint: "Click your states along the border on the map, then save.",
    free: (template, count) => `${template} (${count} free)`,
    postures: { hold: "Hold", attack: "Attack", breakthrough: "Break through" },
    airWings: "Air wings", freeNow: "Free", aircraftLost: "Aircraft lost last turn", needFront: "Open a front first: wings fly over a front or the states along it.",
    wings: "Wings", wingType: "Wing type", fighterMission: "Fighters: air superiority", bomberMission: "Bombers: ground support", airZone: "Air zone",
    frontAgainst: (enemy) => `Front → ${enemy}`, recall: "Recall", superiority: "Air superiority", support: "Ground support",
    templates: { chasse: "fighters", bombardement: "bombers", flotte: "fleets", infanterie: "infantry", blindes: "armour", artillerie: "artillery" },
    fleets: "Fleets", freeFleets: "Free fleets", noZone: "No sea zone borders your coasts.", noSeaZones: "This map has no sea zones.",
    missions: { escort: "Convoy escort", blockade: "Blockade", support: "Landing support" }, seaZone: "Sea zone", naval: "Naval mission",
    contested: "contested", heldBy: (who) => `held by ${who}`, blockadeAgainst: "Blockade against you", blockadeHolds: "Your blockade holds",
    coastsCut: (n) => `${n} coast(s) cut off`, landing: "Landing", onCoast: "Free divisions on your coasts", noCoast: "No enemy coast to land on.",
    divisionsToLand: "Divisions to land", coast: "Coast", prepare: "Prepare", embarked: "Embarked for next turn",
    waiting: (what) => `Waiting for ${what} to finish; your order will then be applied.`, busy: (what) => `The game is still busy (${what}); try again in a moment.`,
    tasks: { simulateTimelineJump: "the time skip", createInteractive: "the interactive event", consolidateHistoryNow: "the history summary", "held-turn": "the turn held at the Projects board", "held-segment": "a held part of the time skip", task: "a background task" },
    jevTitle: "Local decider (Jev)", jevLine: (n, s) => `${n} decision(s) last turn, in ${s} s`, jevStopped: (why) => `stopped: ${why}`,
  },
  fr: {
    title: "Fronts", close: "Fermer", tabs: { land: "Terre", air: "Air", sea: "Mer" },
    noArmies: "Cette partie n'a pas d'armées suivies par le moteur.", loading: "Chargement…", loadingMap: "Chargement de la carte…",
    openFront: "Ouvrir un front", noWar: "Vous n'êtes en guerre avec personne : déclarez d'abord une guerre.", enemy: "Ennemi",
    statesDrawn: (n) => `${n} état(s) tracé(s)`, openOnLine: "Ouvrir sur ce tracé", cancel: "Annuler", wholeBorder: "Toute la frontière", drawOnMap: "Tracer sur la carte",
    divisions: (n) => `${n} division(s)`, line: "Ligne", axis: "Axe", send: "Envoyer", redraw: "Retracer", saveLine: "Enregistrer le tracé", states: (n) => `${n} état(s)`,
    closeFront: "Fermer le front", noLongerAtWar: "Plus en guerre : le front fermera au prochain tour.", drawHint: "Cliquez vos états le long de la frontière sur la carte, puis enregistrez.",
    free: (template, count) => `${template} (${count} libre${count > 1 ? "s" : ""})`,
    postures: { hold: "Tenir", attack: "Attaquer", breakthrough: "Percer" },
    airWings: "Escadres aériennes", freeNow: "Libres", aircraftLost: "Avions perdus au dernier tour", needFront: "Ouvrez d'abord un front : les escadres volent au-dessus d'un front ou de ses états.",
    wings: "Escadres", wingType: "Type d'escadre", fighterMission: "Chasse : supériorité aérienne", bomberMission: "Bombardiers : appui au sol", airZone: "Zone aérienne",
    frontAgainst: (enemy) => `Front → ${enemy}`, recall: "Rappeler", superiority: "Supériorité aérienne", support: "Appui au sol",
    templates: { chasse: "chasse", bombardement: "bombardement", flotte: "flottes", infanterie: "infanterie", blindes: "blindés", artillerie: "artillerie" },
    fleets: "Flottes", freeFleets: "Flottes libres", noZone: "Aucune zone de mer ne borde vos côtes.", noSeaZones: "Cette carte n'a pas de zones de mer.",
    missions: { escort: "Escorte des convois", blockade: "Blocus", support: "Appui d'un débarquement" }, seaZone: "Zone de mer", naval: "Mission navale",
    contested: "disputée", heldBy: (who) => `tenue par ${who}`, blockadeAgainst: "Blocus contre vous", blockadeHolds: "Votre blocus tient",
    coastsCut: (n) => `${n} côte(s) coupée(s)`, landing: "Débarquement", onCoast: "Divisions libres sur vos côtes", noCoast: "Aucune côte ennemie où débarquer.",
    divisionsToLand: "Divisions à débarquer", coast: "Côte", prepare: "Préparer", embarked: "Embarquées pour le prochain tour",
    waiting: (what) => `En attente de la fin de ${what} ; votre ordre sera appliqué ensuite.`, busy: (what) => `Le jeu est encore occupé (${what}) ; réessayez dans un instant.`,
    tasks: { simulateTimelineJump: "l'avance du temps", createInteractive: "l'événement interactif", consolidateHistoryNow: "le résumé de l'histoire", "held-turn": "le tour retenu au tableau des Projets", "held-segment": "une partie retenue de l'avance du temps", task: "une tâche en arrière-plan" },
    jevTitle: "Décideur local (Jev)", jevLine: (n, s) => `${n} décision(s) au dernier tour, en ${s} s`, jevStopped: (why) => `arrêté : ${why}`,
  },
};

export const isFrench = (language) => /^fr\b/i.test(String(language || ""));
export const frontsPanelWords = (language = "en") => (isFrench(language) ? WORDS.fr : WORDS.en);

// Ce qui occupe le jeu, en mots (busyReasons de simulationStatus.js).
export const describeBusy = (reasons, language = "en") => {
  const w = frontsPanelWords(language);
  const named = [...new Set((reasons ?? []).map((reason) => w.tasks[reason] ?? w.tasks.task))];
  return named.join(", ") || w.tasks.task;
};

const POSTURE_FR = { hold: "tient la ligne", attack: "passe à l'attaque", breakthrough: "passe en percée" };
const MISSION_FR = { superiority: "en supériorité aérienne", support: "en appui au sol", escort: "en escorte des convois", blockade: "en blocus", support_naval: "en appui d'un débarquement" };
const TEMPLATE_FR = { chasse: "de chasse", bombardement: "de bombardement" };

// Une note du moteur (« frontOps — … », « airOps — … », « navalOps — … »), pour
// le joueur. `zoneName(id)` : le nom de la zone de mer (seaNames.js).
export const panelNoteText = (text, { language = "en", zoneName = (id) => `sea zone ${id}` } = {}) => {
  const note = String(text ?? "").replace(/^(frontOps|airOps|navalOps) — /, "").trim();
  if (!isFrench(language)) return note.replace(/in sea zone (\d+)/, (_, id) => `in ${zoneName(id)}`);
  const the = (name, form = "") => frenchPolityWithArticle(name.trim(), form);
  const place = (name) => placeNameFor(name.trim(), "fr");
  const rules = [
    [/^(.+?) opened a front against (.+?) \((\w+)\)\.$/, (m) => `Front ouvert contre ${the(m[2])} (${WORDS.fr.postures[m[3]]?.toLowerCase() ?? m[3]}).`],
    [/^(.+?)'s front against (.+?) now (\w+)(?: \(axis (.+)\))?\.$/, (m) => `Le front contre ${the(m[2])} ${POSTURE_FR[m[3]] ?? m[3]}${m[4] ? `, axe ${place(m[4])}` : ""}.`],
    [/^(.+?)'s front against (.+?) redrawn \((.+)\)\.$/, (m) => `Front contre ${the(m[2])} retracé (${m[3] === "the whole border" ? "toute la frontière" : m[3].replace("state(s)", "état(s)")}).`],
    [/^(.+?) closed its front against (.+?)\.$/, (m) => `Front contre ${the(m[2])} fermé.`],
    [/^(.+?) sent (\d+) division\(s\) to the front against (.+?)\.$/, (m) => `${m[2]} division(s) envoyée(s) sur le front contre ${the(m[3])}.`],
    [/^(.+?) has no free land division to send to the front against (.+?)\.$/, (m) => `Aucune division terrestre libre à envoyer sur le front contre ${the(m[2])}.`],
    [/^(.+?) is not at war with (.+?): declare the war before opening a front\.$/, (m) => `Vous n'êtes pas en guerre avec ${the(m[2])} : déclarez la guerre avant d'ouvrir un front.`],
    [/^(.+?) holds no state in contact with (.+?)( in the drawn sector)?: there is no front to open\.$/, (m) => `Aucun de vos états ne touche ${the(m[2])}${m[3] ? " dans le tracé" : ""} : pas de front à ouvrir.`],
    [/^(.+?) is no longer at war with (.+?): the front can only hold\.$/, (m) => `Plus en guerre avec ${the(m[2])} : le front ne peut que tenir.`],
    [/^the drawn sector touches no state of (.+?): pick states of yours along the border\.$/, (m) => `Le tracé ne touche aucun état ${the(m[1], "de")} : choisissez vos états le long de la frontière.`],
    [/^(.+?) already has (\d+) fronts\.$/, (m) => `Vous avez déjà ${m[2]} fronts.`],
    [/^(.+?) sent (\d+) (\w+) wing\(s\) on (\w+)\.$/, (m) => `${m[2]} escadre(s) ${TEMPLATE_FR[m[3]] ?? m[3]} ${MISSION_FR[m[4]] ?? m[4]}.`],
    [/^(.+?) has no free (\w+) wing for this mission\.$/, (m) => `Aucune escadre ${TEMPLATE_FR[m[2]] ?? m[2]} libre pour cette mission.`],
    [/^(.+?) recalled (\d+) wing\(s\)\.$/, (m) => `${m[2]} escadre(s) rappelée(s).`],
    [/^(.+?) recalled (\d+) fleet\(s\)\.$/, (m) => `${m[2]} flotte(s) rappelée(s).`],
    [/^(.+?) sent (\d+) fleet\(s\) on (\w+) in sea zone (\d+)\.$/, (m) => `${m[2]} flotte(s) ${m[3] === "support" ? MISSION_FR.support_naval : MISSION_FR[m[3]] ?? m[3]} : ${zoneName(m[4])}.`],
    [/^(.+?) has no free fleet for this mission\.$/, () => "Aucune flotte libre pour cette mission."],
    [/^(.+?) embarks (\d+) division\(s\) to land on (.+?) next turn\.$/, (m) => `${m[2]} division(s) embarquée(s) : débarquement à ${place(m[3])} au prochain tour.`],
    [/^(.+?) has no free division on its own coast to embark\.$/, () => "Aucune division libre sur l'une de vos côtes à embarquer."],
    [/^(.+?) can only land on a state held by an enemy at war\.$/, () => "On ne débarque que sur un état tenu par un ennemi en guerre."],
    [/^(.+?) has no coast to land on\.$/, (m) => `${place(m[1])} n'a pas de côte où débarquer.`],
    [/^the enemy dominates every sea zone off (.+?): no landing\.$/, (m) => `L'ennemi tient toutes les eaux au large de ${place(m[1])} : pas de débarquement.`],
    [/^the enemy dominates sea zone (\d+): no landing there\.$/, (m) => `L'ennemi tient ${zoneName(m[1])} : pas de débarquement là.`],
    [/^(.+?) already prepares a landing there\.$/, () => "Un débarquement y est déjà préparé."],
  ];
  for (const [pattern, write] of rules) {
    const match = note.match(pattern);
    if (match) return capitalizeFirst(write(match));
  }
  return `Ordre refusé ou modifié : ${note}`;
};

// Un choix du décideur local (localDecider.js, en anglais pour Jev), pour le joueur.
export const jevChoiceText = (choice, language = "en") => {
  const text = String(choice ?? "").trim();
  if (!isFrench(language)) return text;
  const the = (name) => frenchPolityWithArticle(name.trim());
  const place = (name) => placeNameFor(name.trim(), "fr");
  const rules = [
    [/^Hold the line against (.+)$/, (m) => `Tenir la ligne face à ${the(m[1])}`],
    [/^Attack toward (.+?) \((\d+) enemy divisions there\)$/, (m) => `Attaquer vers ${place(m[1])} (${m[2]} division(s) ennemie(s))`],
    [/^Break through toward (.+?) \((\d+) enemy divisions there\)$/, (m) => `Percer vers ${place(m[1])} (${m[2]} division(s) ennemie(s))`],
    [/^Keep them in reserve$/, () => "Garder les divisions en réserve"],
    [/^Send (\d+) to the front against (.+)$/, (m) => `Envoyer ${m[1]} division(s) sur le front contre ${the(m[2])}`],
    [/^Keep them at home$/, () => "Garder l'aviation et la flotte à leurs bases"],
    [/^Send (\d+) fighter wings over the front against (.+)$/, (m) => `Envoyer ${m[1]} escadre(s) de chasse au-dessus du front contre ${the(m[2])}`],
    [/^Send (\d+) bomber wings to support the front against (.+)$/, (m) => `Envoyer ${m[1]} escadre(s) de bombardement en appui du front contre ${the(m[2])}`],
    [/^Blockade the enemy coast off (.+?) with (\d+) fleets$/, (m) => `Blocus de la côte ennemie au large de ${place(m[1])} (${m[2]} flotte(s))`],
    [/^Escort our convoys off (.+?) with (\d+) fleets$/, (m) => `Escorter nos convois au large de ${place(m[1])} (${m[2]} flotte(s))`],
    [/^Land (\d+) divisions at (.+?), with the fleet in support$/, (m) => `Débarquer ${m[1]} divisions à ${place(m[2])}, avec l'appui de la flotte`],
    [/^Recruit nothing and keep the stockpile$/, () => "Ne rien recruter et garder la réserve"],
    [/^Raise one (.+)$/, (m) => `Lever une ${m[1]}`],
  ];
  for (const [pattern, write] of rules) {
    const match = text.match(pattern);
    if (match) return write(match);
  }
  return text;
};

// Le nom d'un pays pour le panneau.
export const panelPolity = (name, language = "en") => (isFrench(language) ? frenchPolityName(name) : name);
