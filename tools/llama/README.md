# llama.cpp pour Jev (phase 7.9)

`bin/` contient llama.cpp, build CPU b11225 pour Windows x64. Ce dossier n'est pas
suivi par Git (voir `.gitignore`).

Pour lancer Jev, le décideur local : `npm run jev`, ou `tools\llama\start-jev.cmd`.
Le serveur écoute sur `127.0.0.1:8081`, avec le GGUF de LM Studio
(`Jev-Style-0.8B-Decision-v3-Q8_0.gguf`) et les réglages
`-b 64 -ub 64 --checkpoint-min-step 0`.

Il faut ensuite activer « Local decider (Jev) » dans Réglages > IA.
