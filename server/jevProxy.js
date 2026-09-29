// Phase 7.9 — le relais vers Jev, le décideur local (llama-server, port 8081 ;
// tools/llama, npm run jev). Le jeu parle au serveur du jeu, qui relaie : pas de
// question d'origine croisée, et l'adresse se change à un seul endroit
// (OH_JEV_URL). Une requête /completion est relayée telle quelle ; /health dit
// si le serveur répond.

export const JEV_URL = String(process.env.OH_JEV_URL || "http://127.0.0.1:8081").replace(/\/+$/, "");

const withTimeout = async (url, options, ms) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const registerJevRoutes = (app, jsonParser) => {
  app.get("/api/jev/health", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const response = await withTimeout(`${JEV_URL}/health`, {}, 1500);
      res.status(response.ok ? 200 : 503).json({ ok: response.ok });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.post("/api/jev/completion", jsonParser, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = req.body && typeof req.body === "object" ? req.body : {};
    if (typeof body.prompt !== "string" || !body.prompt) return res.status(400).json({ error: "prompt required" });
    try {
      const response = await withTimeout(`${JEV_URL}/completion`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: body.prompt,
          n_predict: 1,
          temperature: 0,
          n_probs: Math.min(100, Math.max(1, Number(body.n_probs) || 50)),
          cache_prompt: body.cache_prompt !== false,
        }),
      }, 30000);
      const text = await response.text();
      res.status(response.status).type("application/json").send(text);
    } catch {
      res.status(503).json({ error: "the local decider does not answer" });
    }
  });
};
