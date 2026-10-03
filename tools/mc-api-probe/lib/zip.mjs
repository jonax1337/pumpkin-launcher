// Minimaler Zip-Leser (nur Lesen, nur Stored/Deflate), damit das Werkzeug ohne `jar` und ohne Pakete auskommt.
import { openSync, readSync, fstatSync, closeSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_COMMENT_LENGTH = 0xffff;
const END_RECORD_MIN_SIZE = 22;
const STORED = 0;
const DEFLATED = 8;

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  readSync(fd, buffer, 0, length, position);
  return buffer;
}

function findEndRecord(fd, size) {
  const tailLength = Math.min(size, END_RECORD_MIN_SIZE + MAX_COMMENT_LENGTH);
  const tail = readAt(fd, size - tailLength, tailLength);
  for (let i = tail.length - END_RECORD_MIN_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) === END_OF_CENTRAL_DIRECTORY) return tail.subarray(i);
  }
  throw new Error("Kein Zip-Endrecord gefunden");
}

function parseCentralDirectory(directory, entryCount) {
  const entries = new Map();
  let offset = 0;
  for (let i = 0; i < entryCount; i++) {
    if (directory.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw new Error("Zip-Verzeichnis beschaedigt");
    const nameLength = directory.readUInt16LE(offset + 28);
    const extraLength = directory.readUInt16LE(offset + 30);
    const commentLength = directory.readUInt16LE(offset + 32);
    const name = directory.toString("utf8", offset + 46, offset + 46 + nameLength);
    entries.set(name, {
      method: directory.readUInt16LE(offset + 10),
      compressedSize: directory.readUInt32LE(offset + 20),
      localHeaderOffset: directory.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntryData(fd, entry) {
  const header = readAt(fd, entry.localHeaderOffset, 30);
  if (header.readUInt32LE(0) !== LOCAL_FILE_HEADER) throw new Error("Zip-Eintrag beschaedigt");
  const dataStart = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const raw = readAt(fd, dataStart, entry.compressedSize);
  if (entry.method === STORED) return raw;
  if (entry.method === DEFLATED) return inflateRawSync(raw);
  throw new Error(`Zip-Kompressionsverfahren ${entry.method} nicht unterstuetzt`);
}

/** Oeffnet ein Zip und liefert die Eintragsnamen sowie einen Leser fuer einzelne Eintraege. */
export function openZip(path) {
  const fd = openSync(path, "r");
  try {
    const end = findEndRecord(fd, fstatSync(fd).size);
    const entryCount = end.readUInt16LE(10);
    const directorySize = end.readUInt32LE(12);
    const directoryOffset = end.readUInt32LE(16);
    const entries = parseCentralDirectory(readAt(fd, directoryOffset, directorySize), entryCount);
    return {
      names: [...entries.keys()],
      read: (name) => {
        const entry = entries.get(name);
        if (!entry) throw new Error(`${name} fehlt in ${path}`);
        return readEntryData(fd, entry);
      },
      close: () => closeSync(fd),
    };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}
