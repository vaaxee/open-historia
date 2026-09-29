// Phase 9 (suite) — la texture Natural Earth II : la découpe et la couche.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";
import { encodePngRgba, isWater, parentTile, sourceTile } from "./texture-tiles.mjs";
import { TEXTURE_MAX_ZOOM, textureLayerSpec } from "../../src/Game/Map/textureLayer.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const read = (...parts) => fs.readFileSync(path.join(here, "..", "..", ...parts), "utf8");

// Une petite source plate carrée : l'ouest en mer NE2, l'est en terre verte.
const source = () => {
  const width = 64; const height = 32;
  const pixels = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const at = (row * width + col) * 3;
      pixels.set(col < width / 2 ? [109, 164, 201] : [120, 150, 90], at);
    }
  }
  return { pixels, width, height };
};

test("NE2 water is recognised; land, ice and desert are not", () => {
  assert.equal(isWater(109, 164, 201), true);
  assert.equal(isWater(120, 150, 90), false);
  assert.equal(isWater(245, 245, 250), false, "ice");
  assert.equal(isWater(214, 196, 150), false, "desert");
});

test("tiles: sea transparent, land opaque; a parent averages its children; a tile all at sea is skipped", () => {
  const tile = sourceTile(source(), 1, 1, 0);
  assert.ok(tile, "the eastern tile has land");
  assert.deepEqual([...tile.slice(0, 4)], [120, 150, 90, 255]);
  assert.equal(sourceTile(source(), 1, 0, 0), null, "the western tile is all sea");
  const parent = parentTile([null, tile, null, tile]);
  assert.deepEqual([...parent.slice(0, 4)], [0, 0, 0, 0], "the sea quarter stays transparent");
  const k = (0 * 256 + 200) * 4;
  assert.deepEqual([...parent.slice(k, k + 4)], [120, 150, 90, 255]);
  assert.equal(parentTile([null, null, null, null]), null);
  const png = encodePngRgba(tile);
  assert.deepEqual([...png.subarray(1, 4)], [80, 78, 71]);
  assert.equal(png[25], 6, "RGBA");
  const idat = png.indexOf("IDAT");
  const raw = zlib.inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4)));
  assert.equal(raw.length, 256 * (256 * 4 + 1));
});

test("the layer follows the Animations setting and fades out past the source's zooms", () => {
  assert.equal(TEXTURE_MAX_ZOOM, 6);
  const full = textureLayerSpec("full");
  const off = textureLayerSpec("off");
  assert.deepEqual([full.maxzoom, textureLayerSpec("reduced").maxzoom, off.maxzoom], [9, 8, 7]);
  assert.deepEqual([full.paint["raster-fade-duration"], off.paint["raster-fade-duration"]], [300, 0]);
  assert.deepEqual(full.paint["raster-opacity"], ["interpolate", ["linear"], ["zoom"], 7, 1, 9, 0]);
  assert.deepEqual(textureLayerSpec("nonsense"), full);
});

test("wired: the route, the layer under the countries and the relief", () => {
  assert.match(read("server", "worldMap.js"), /app\.get\("\/api\/worldmap\/texture\/:z\/:x\/:y\.png"/);
  const order = read("src", "Game", "Map", "mapLayerOrder.js");
  const at = (id) => order.indexOf(`"${id}"`);
  assert.ok(at("worldmap-terrain") < at("worldmap-texture") && at("worldmap-texture") < at("worldmap-fill") && at("worldmap-fill") < at("worldmap-relief"));
  const layer = read("src", "Game", "Map", "WorldMapLayer.jsx");
  assert.match(layer, /<Layer id="worldmap-texture" type="raster" minzoom=\{texture\.minzoom\} maxzoom=\{texture\.maxzoom\} paint=\{texture\.paint\} \/>/);
  assert.match(layer, /window\.addEventListener\("mapSettings:updated", update\);/);
});
