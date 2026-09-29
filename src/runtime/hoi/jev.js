// Couche HOI4 — Jev, le décideur local (phase 7.9).
//
// Run tests: node --test src/runtime/hoi/localDecider.test.js
//
// Jev-Style 0.8B Decision v3 (un GGUF de LM Studio) tourne sous llama-server, sur
// le port 8081 (tools/llama, npm run jev). Il ne rédige rien : il juge. Sa fiche
// dit le format, qu'on suit à la lettre :
//
//   State:
//   <l'état>
//
//   Question [choice]: <la question>
//   Options:
//   - <option 1>
//   - <option 2>
//   Judge each option:
//   <option 1> ->
//
// Le score d'une option est logprob(" yes") − logprob(" no") du jeton qui suit
// son « -> » ; une requête par option, coupée juste après son « -> », avec
// cache_prompt : tout ce qui précède est déjà dans le cache du serveur, seule la
// fin se relit. Les probabilités : softmax(score / 0,88), la température de la
// fiche. La meilleure option est celle au plus haut score.

export const JEV_TUNING = Object.freeze({
  temperature: 0.8800546821789332,
  // Les jetons lus au-delà du top : un « yes » ou un « no » absent du top vaut le
  // plus petit logprob lu, moins 1.
  nProbs: 50,
  requestTimeoutMs: 20000,
  healthTimeoutMs: 1500,
});

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Le prompt de l'option `upto` (0 = la première) : tout jusqu'à son « -> ».
export const renderJevPrompt = ({ state, question, options, upto = 0 }) => [
  "State:",
  String(state ?? "").trim(),
  "",
  `Question [choice]: ${clean(question)}`,
  "Options:",
  ...options.map((option) => `- ${clean(option)}`),
  "Judge each option:",
  ...options.slice(0, upto + 1).map((option) => `${clean(option)} ->`),
].join("\n");

// Le score d'une réponse de llama-server (/completion, n_probs) :
// logprob(" yes") − logprob(" no") du premier jeton. NaN si illisible.
export const readJevScore = (response) => {
  const first = Array.isArray(response?.completion_probabilities) ? response.completion_probabilities[0] : null;
  const top = Array.isArray(first?.top_logprobs) ? first.top_logprobs : Array.isArray(first?.probs) ? first.probs : [];
  if (!top.length) return NaN;
  const logprobOf = (entry) => (Number.isFinite(entry?.logprob) ? entry.logprob : Number.isFinite(entry?.prob) && entry.prob > 0 ? Math.log(entry.prob) : NaN);
  const tokenOf = (entry) => String(entry?.token ?? entry?.tok_str ?? "");
  const floor = Math.min(...top.map(logprobOf).filter(Number.isFinite)) - 1;
  const find = (word) => {
    const hit = top.find((entry) => tokenOf(entry) === ` ${word}`) ?? top.find((entry) => tokenOf(entry).trim().toLowerCase() === word);
    return hit ? logprobOf(hit) : floor;
  };
  return find("yes") - find("no");
};

export const softmax = (scores, temperature = JEV_TUNING.temperature) => {
  const finite = scores.map((score) => (Number.isFinite(score) ? score : -99));
  const top = Math.max(...finite);
  const exp = finite.map((score) => Math.exp((score - top) / temperature));
  const sum = exp.reduce((a, b) => a + b, 0) || 1;
  return exp.map((value) => value / sum);
};

// Le client : `fetchImpl` (fetch, ou un faux serveur dans les tests), `url` du
// point /completion (par défaut le relais du serveur du jeu, /api/jev/completion).
export const createJevClient = ({ fetchImpl = globalThis.fetch, url = "/api/jev/completion", healthUrl = "/api/jev/health", now = () => Date.now() } = {}) => {
  const post = async (body, timeoutMs) => {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response?.ok) throw new Error(`Jev answered ${response?.status ?? "nothing"}`);
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return {
    // Le serveur répond-il ? (un délai court : sinon, les règles du moteur).
    health: async () => {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), JEV_TUNING.healthTimeoutMs) : null;
      try {
        const response = await fetchImpl(healthUrl, controller ? { signal: controller.signal } : {});
        return Boolean(response?.ok);
      } catch {
        return false;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    // Les scores d'une question : une requête par option. Renvoie { scores,
    // probs, best, ms, promptTokens, cachedTokens }.
    score: async ({ state, question, options }) => {
      const started = now();
      const scores = [];
      let promptTokens = 0; let cachedTokens = 0;
      for (let upto = 0; upto < options.length; upto += 1) {
        const answer = await post({
          prompt: renderJevPrompt({ state, question, options, upto }),
          n_predict: 1,
          temperature: 0,
          n_probs: JEV_TUNING.nProbs,
          cache_prompt: true,
        }, JEV_TUNING.requestTimeoutMs);
        const score = readJevScore(answer);
        if (!Number.isFinite(score)) throw new Error("Jev gave no yes/no probabilities");
        scores.push(Math.round(score * 1000) / 1000);
        promptTokens += Number(answer?.timings?.prompt_n) || 0;
        cachedTokens += Number(answer?.timings?.cache_n) || 0;
      }
      const probs = softmax(scores);
      const best = scores.indexOf(Math.max(...scores));
      return { scores, probs, best, ms: now() - started, promptTokens, cachedTokens };
    },
  };
};
