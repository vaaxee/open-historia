// Phase 7.9 — lance Jev, le décideur local, sous llama-server.
//
//   npm run jev          (ou tools/llama/start-jev.cmd)
//
// llama.cpp (build CPU b11225) est dans tools/llama/bin, hors de Git ; le modèle
// est le GGUF que LM Studio a téléchargé (Jev-Style 0.8B Decision v3, Q8_0), dans
// %USERPROFILE%\.lmstudio\models. Le serveur écoute sur 127.0.0.1:8081, avec des
// lots de 64 jetons (-b 64 -ub 64 : la lecture la plus rapide mesurée sur ce PC)
// et des points de reprise du cache sans écart minimal (--checkpoint-min-step 0),
// pour que chaque requête reprenne la fiche du pays déjà lue ; le jeu envoie
// cache_prompt à chaque requête (runtime/hoi/jev.js).
//
// OH_LLAMA_DIR : un autre dossier de llama.cpp ; OH_JEV_MODEL : un autre GGUF ;
// OH_JEV_PORT : un autre port (le serveur du jeu lit OH_JEV_URL).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { spawn } from "node:child_process";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");

export const JEV_SERVER_ARGS = Object.freeze(["-b", "64", "-ub", "64", "--checkpoint-min-step", "0", "-c", "8192"]);

// Le premier GGUF de Jev sous un dossier (LM Studio range par auteur/dépôt).
export const findJevModel = (dir, depth = 0) => {
  if (depth > 4 || !fs.existsSync(dir)) return "";
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && /^jev.*decision.*\.gguf$/i.test(entry.name)) return full;
    if (entry.isDirectory()) {
      const found = findJevModel(full, depth + 1);
      if (found) return found;
    }
  }
  return "";
};

export const jevServerCommand = ({ llamaDir, model, port = 8081 }) => ({
  command: path.join(llamaDir, process.platform === "win32" ? "llama-server.exe" : "llama-server"),
  args: ["-m", model, "--host", "127.0.0.1", "--port", String(port), ...JEV_SERVER_ARGS],
});

const isMain = process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const llamaDir = process.env.OH_LLAMA_DIR || path.join(root, "tools", "llama", "bin");
  const model = process.env.OH_JEV_MODEL || findJevModel(path.join(os.homedir(), ".lmstudio", "models"));
  const port = Number(process.env.OH_JEV_PORT) || 8081;
  const { command, args } = jevServerCommand({ llamaDir, model, port });
  if (!fs.existsSync(command)) {
    console.error(`llama-server introuvable : ${command}\nCopiez llama.cpp (build CPU) dans tools/llama/bin, ou indiquez OH_LLAMA_DIR.`);
    process.exit(1);
  }
  if (!model || !fs.existsSync(model)) {
    console.error("Modèle Jev introuvable dans ~/.lmstudio/models : téléchargez Jev-Style-0.8B-Decision-v3-GGUF dans LM Studio, ou indiquez OH_JEV_MODEL.");
    process.exit(1);
  }
  console.log(`Jev : ${path.basename(model)} sur http://127.0.0.1:${port}`);
  const child = spawn(command, args, { stdio: "inherit", cwd: llamaDir });
  child.on("exit", (code) => process.exit(code ?? 0));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
}
