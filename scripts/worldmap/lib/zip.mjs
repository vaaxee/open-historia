// Lecture d'une archive ZIP (répertoire central, entrées « stockées » ou
// « deflate »), sans dépendance : Natural Earth et GeoNames livrent des ZIP.

import fs from "fs";
import zlib from "zlib";

export const readZip = (file) => {
  const buffer = fs.readFileSync(file);
  // La fin du répertoire central : signature 0x06054b50, dans les 64 Ko de la fin.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error(`${file} : pas une archive ZIP`);
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let k = 0; k < count; k += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${file} : répertoire central abîmé`);
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, { method, compressed, local });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  const read = (name) => {
    const entry = entries.get(name);
    if (!entry) return null;
    const { method, compressed, local } = entry;
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + compressed);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return zlib.inflateRawSync(data);
    throw new Error(`${name} : compression ${method} non gérée`);
  };
  return { names: [...entries.keys()], read };
};
