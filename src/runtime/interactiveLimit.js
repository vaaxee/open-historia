// Phase 10 — la fin des événements interactifs.
//
// Une scène interactive ne finissait que lorsque l'IA la déclarait résolue :
// certaines tournaient sans fin, un choix après l'autre. Elle a désormais au
// plus INTERACTIVE_MAX_BEATS échanges ; à l'avant-dernier l'IA est prévenue, au
// dernier elle doit conclure, et si elle ne le fait pas le moteur conclut la
// scène avec ce qui s'est passé. Pur.

export const INTERACTIVE_MAX_BEATS = 6;

const list = (value) => (Array.isArray(value) ? value : []);

// Combien d'échanges restent après celui qu'on joue (`history` : ceux déjà joués).
export const beatsLeft = (history) => Math.max(0, INTERACTIVE_MAX_BEATS - list(history).length - 1);

// Ce choix est-il le dernier ? Alors la scène se conclut, quoi que dise l'IA.
export const mustResolve = (history) => beatsLeft(history) === 0;

// La consigne jointe au choix du joueur, pour que l'IA amène la fin.
export const closingDirective = (history) => {
  const left = beatsLeft(history);
  if (left === 0) return "\n[Scene limit] This is the LAST exchange of this scene: resolve it now (resolved: true), with a clear outcome.";
  if (left === 1) return "\n[Scene limit] One exchange remains after this one: steer the scene toward its outcome.";
  return "";
};
