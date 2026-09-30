/*! Test G — le relevé des temps d'un tour (src/runtime/turnProfile.js). */
// POST /api/debug/turn-profile : une ligne JSON de plus dans
// DATA/logs/turn-profile.jsonl (le fichier est ramené à sa seconde moitié
// au-delà de 2 Mo). GET /api/debug/turn-profile?limit=N : les N derniers.

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir.js";

export const TURN_PROFILE_MAX_BYTES = 2 * 1024 * 1024;

export const appendTurnProfile = (entry, { file = path.join(DATA_DIR, "logs", "turn-profile.jsonl"), maxBytes = TURN_PROFILE_MAX_BYTES } = {}) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ receivedAt: new Date().toISOString(), ...entry })}\n`);
  if (fs.statSync(file).size > maxBytes) {
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    fs.writeFileSync(file, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`);
  }
  return file;
};

export const readTurnProfiles = ({ file = path.join(DATA_DIR, "logs", "turn-profile.jsonl"), limit = 20 } = {}) => {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).slice(-limit).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
};

export const registerTurnProfileRoutes = (app, jsonParser) => {
  app.post("/api/debug/turn-profile", jsonParser, (req, res) => {
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ ok: false });
    try {
      appendTurnProfile(body);
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: String(error?.message ?? error) });
    }
  });
  app.get("/api/debug/turn-profile", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ profiles: readTurnProfiles({ limit: Math.max(1, Math.min(200, Number(req.query.limit) || 20)) }) });
  });
};
