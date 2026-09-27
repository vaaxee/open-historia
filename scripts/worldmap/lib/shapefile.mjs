// Lecture d'un shapefile (.shp + .dbf) en entités GeoJSON, sans dépendance.
// Types gérés : points, polylignes, polygones (et leurs variantes Z et M).

const readDbf = (buffer, encoding = "utf8") => {
  const count = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  for (let offset = 32; buffer[offset] !== 0x0d && offset < headerLength; offset += 32) {
    const name = buffer.toString("latin1", offset, offset + 11).replace(/\0.*$/, "");
    fields.push({ name, type: String.fromCharCode(buffer[offset + 11]), length: buffer[offset + 16] });
  }
  const decoder = new TextDecoder(encoding);
  const records = [];
  for (let k = 0; k < count; k += 1) {
    let offset = headerLength + k * recordLength + 1;
    const record = {};
    for (const field of fields) {
      const raw = decoder.decode(buffer.subarray(offset, offset + field.length)).trim();
      offset += field.length;
      if (field.type === "N" || field.type === "F") record[field.name] = raw === "" ? null : Number(raw);
      else if (field.type === "L") record[field.name] = /^[YyTt]/.test(raw);
      else record[field.name] = raw;
    }
    records.push(record);
  }
  return records;
};

// Anneaux d'un polygone shapefile : sens horaire = extérieur, antihoraire = trou.
const signedArea = (ring) => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum / 2;
};
const inRing = ([x, y], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const toPolygons = (rings) => {
  const outers = []; const holes = [];
  for (const ring of rings) (signedArea(ring) < 0 ? outers : holes).push(ring);
  const polygons = outers.map((ring) => [ring]);
  for (const hole of holes) {
    const owner = polygons.find(([outer]) => inRing(hole[0], outer));
    if (owner) owner.push(hole); else polygons.push([hole.slice().reverse()]);
  }
  return polygons;
};

const readShp = (buffer) => {
  const shapes = [];
  let offset = 100;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readInt32BE(offset + 4) * 2;
    const at = offset + 8;
    const type = buffer.readInt32LE(at);
    const base = type % 10; // 1 point, 3 polyligne, 5 polygone (Z : +10, M : +20)
    if (type === 0) shapes.push(null);
    else if (base === 1) shapes.push({ type: "Point", coordinates: [buffer.readDoubleLE(at + 4), buffer.readDoubleLE(at + 12)] });
    else if (base === 3 || base === 5) {
      const numParts = buffer.readInt32LE(at + 36);
      const numPoints = buffer.readInt32LE(at + 40);
      const parts = [];
      for (let p = 0; p < numParts; p += 1) parts.push(buffer.readInt32LE(at + 44 + p * 4));
      const pointsAt = at + 44 + numParts * 4;
      const rings = parts.map((start, p) => {
        const stop = p + 1 < numParts ? parts[p + 1] : numPoints;
        const ring = [];
        for (let i = start; i < stop; i += 1) ring.push([buffer.readDoubleLE(pointsAt + i * 16), buffer.readDoubleLE(pointsAt + i * 16 + 8)]);
        return ring;
      });
      if (base === 3) shapes.push(rings.length === 1 ? { type: "LineString", coordinates: rings[0] } : { type: "MultiLineString", coordinates: rings });
      else {
        const polygons = toPolygons(rings);
        shapes.push(polygons.length === 1 ? { type: "Polygon", coordinates: polygons[0] } : { type: "MultiPolygon", coordinates: polygons });
      }
    } else throw new Error(`type de forme ${type} non géré`);
    offset = at + length;
  }
  return shapes;
};

// Les entités d'un shapefile rangé dans une archive ZIP (lib/zip.mjs).
export const shapefileFromZip = (zip, stem = null) => {
  const shpName = zip.names.find((name) => name.toLowerCase().endsWith(".shp") && (!stem || name.includes(stem)));
  if (!shpName) throw new Error("pas de .shp dans l'archive");
  const base = shpName.slice(0, -4);
  const shapes = readShp(zip.read(shpName));
  const dbf = zip.read(`${base}.dbf`);
  const cpg = zip.read(`${base}.cpg`)?.toString("latin1").trim().toLowerCase();
  const records = dbf ? readDbf(dbf, cpg && !cpg.includes("utf") ? "latin1" : "utf8") : [];
  return shapes.map((geometry, k) => ({ type: "Feature", properties: records[k] ?? {}, geometry }))
    .filter((feature) => feature.geometry);
};
