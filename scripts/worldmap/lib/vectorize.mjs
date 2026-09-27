// Le traceur de contours à la résolution de la génération (0,05°) : le code est
// dans server/worldMapTrace.js, partagé avec le serveur.

import { makeTracer } from "../../../server/worldMapTrace.js";
import { H, LAT_TOP, STEP, W } from "./grid.mjs";

export const { traceArcs, smoothArc, toLngLat, assemble } = makeTracer({ W, H, step: STEP, latTop: LAT_TOP });
