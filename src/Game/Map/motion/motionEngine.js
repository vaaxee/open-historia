// Phase 9 — le moteur d'animation de la carte : une seule boucle
// requestAnimationFrame pour toutes les animations (motionPlan.js), qui ne
// tourne que tant qu'il y a quelque chose à animer, et qui mesure les images
// par seconde pendant ce temps (motionStats, et window.__ohMotion pour le test).
// Le niveau vient du réglage « Animations » (et de prefers-reduced-motion).

import { MAP_SETTING_KEYS, getMapSettingValue } from "../../../runtime/mapSettings.js";
import { fpsFrom, motionTimings, normalizeMotionLevel } from "./motionPlan.js";

export const motionLevel = () => {
  const stored = normalizeMotionLevel(getMapSettingValue(MAP_SETTING_KEYS.animations, "full") || "full");
  if (stored === "full" && typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return "reduced";
  return stored;
};
export const currentTimings = () => motionTimings(motionLevel());

const tasks = new Set();
const ambients = new Set();
let frame = 0;
let frameTimes = [];
let stats = { fps: 0, min: 0, frames: 0, at: "" };

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

const loop = (time) => {
  frame = 0;
  if (tasks.size) {
    frameTimes.push(time);
    if (frameTimes.length > 600) frameTimes = frameTimes.slice(-600);
  }
  for (const task of [...tasks]) {
    const elapsed = time - task.start;
    try {
      task.update(Math.min(1, task.duration > 0 ? elapsed / task.duration : 1), elapsed);
    } catch (error) {
      console.warn("[motion] an animation failed and was stopped.", error);
      tasks.delete(task);
      continue;
    }
    if (elapsed >= task.duration) {
      tasks.delete(task);
      try { task.done?.(); } catch { /* the animation's end is not the loop's */ }
    }
  }
  for (const ambient of ambients) {
    try { ambient(time); } catch { ambients.delete(ambient); }
  }
  if (!tasks.size && frameTimes.length > 1) {
    stats = { ...fpsFrom(frameTimes), at: new Date().toISOString() };
    if (typeof window !== "undefined") window.__ohMotion = { ...stats };
    frameTimes = [];
  }
  if (tasks.size || ambients.size) frame = requestAnimationFrame(loop);
};
const wake = () => {
  if (!frame && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(loop);
};

// Une animation : `update(progress 0 → 1, elapsed ms)` à chaque image, puis
// `done()`. Sans durée (animations désactivées), la fin est posée tout de suite.
// Renvoie une fonction qui l'arrête (en posant sa fin).
export const animate = ({ duration = 0, update, done = null }) => {
  if (!(duration > 0) || typeof requestAnimationFrame !== "function") {
    update(1, duration);
    done?.();
    return () => {};
  }
  const task = { start: now(), duration, update, done };
  tasks.add(task);
  wake();
  return () => {
    if (!tasks.has(task)) return;
    tasks.delete(task);
    task.update(1, duration);
    task.done?.();
  };
};

// Une animation d'ambiance (fronts, flottes, blocus) : appelée à chaque image
// tant qu'elle est inscrite. Renvoie de quoi la désinscrire.
export const addAmbient = (fn) => {
  ambients.add(fn);
  wake();
  return () => ambients.delete(fn);
};

export const motionStats = () => ({ ...stats });
export const motionBusy = () => tasks.size > 0;
