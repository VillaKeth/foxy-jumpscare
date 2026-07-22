/**
 * A minimal ZIP writer.
 *
 * Exists because Compress-Archive writes Windows path separators into the
 * archive - "icons\icon-128.png" instead of "icons/icon-128.png". Section
 * 4.4.17.1 of the ZIP spec is explicit that the forward slash is the only
 * separator, and AMO rejects the upload outright with "Invalid file name in
 * archive". Node has zlib, so this needs no dependency and no shell.
 *
 * Store-vs-deflate is chosen per file: foxy.webm is already compressed and
 * deflating it makes it bigger.
 */
import { deflateRawSync } from 'node:zlib';
import { crc32 } from './crc32.mjs';

// Fixed timestamp so a rebuild of unchanged input produces an identical
// archive. 1980-01-01 is the ZIP epoch: DOS date 0x21, DOS time 0.
const DOS_DATE = 0x21;
const DOS_TIME = 0;

const STORED = 0;
const DEFLATED = 8;

/**
 * @param {{name: string, data: Buffer}[]} files - names are POSIX-style paths
 *   relative to the archive root. Backslashes are normalised, not rejected,
 *   because callers build them with path.join.
 * @returns {Buffer}
 */
export function createZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name.replaceAll('\\', '/'), 'utf8');
    const raw = file.data;

    const deflated = deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const method = useDeflate ? DEFLATED : STORED;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);  // local file header signature
    local.writeUInt16LE(20, 4);          // version needed to extract (2.0)
    local.writeUInt16LE(0, 6);           // general purpose flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);          // extra field length

    chunks.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);  // central directory header signature
    entry.writeUInt16LE(20, 4);          // version made by
    entry.writeUInt16LE(20, 6);          // version needed to extract
    entry.writeUInt16LE(0, 8);           // general purpose flags
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);          // extra field length
    entry.writeUInt16LE(0, 32);          // file comment length
    entry.writeUInt16LE(0, 34);          // disk number start
    entry.writeUInt16LE(0, 36);          // internal file attributes
    entry.writeUInt32LE(0, 38);          // external file attributes
    entry.writeUInt32LE(offset, 42);     // offset of local header

    central.push(entry, name);
    offset += local.length + name.length + body.length;
  }

  const directory = Buffer.concat(central);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);      // end of central directory signature
  end.writeUInt16LE(0, 4);               // this disk number
  end.writeUInt16LE(0, 6);               // disk with the central directory
  end.writeUInt16LE(files.length, 8);    // entries on this disk
  end.writeUInt16LE(files.length, 10);   // entries total
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);         // central directory offset
  end.writeUInt16LE(0, 20);              // archive comment length

  return Buffer.concat([...chunks, directory, end]);
}
