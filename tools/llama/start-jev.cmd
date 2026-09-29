@echo off
rem Phase 7.9 : lance Jev, le decideur local (llama-server, port 8081).
rem Voir scripts/jev/start-server.mjs.
cd /d "%~dp0..\.."
node scripts\jev\start-server.mjs
