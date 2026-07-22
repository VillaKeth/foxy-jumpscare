import { describe, it, expect } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { createZip } from '../tools/lib/zip.mjs';
import { crc32 } from '../tools/lib/crc32.mjs';

/** Read back the central directory - the part AMO reads to check file names. */
function readCentralDirectory(zip) {
  const eocd = zip.lastIndexOf(0x06054b50 & 0xff) >= 0 ? findEocd(zip) : -1;
  expect(eocd).toBeGreaterThan(-1);

  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(offset)).toBe(0x02014b50);
    const method = zip.readUInt16LE(offset + 10);
    const sum = zip.readUInt32LE(offset + 16);
    const compressed = zip.readUInt32LE(offset + 20);
    const uncompressed = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');

    // Body starts after the local header, its own name copy, and any extra.
    const bodyAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const body = zip.subarray(bodyAt, bodyAt + compressed);

    entries.push({
      name,
      method,
      sum,
      uncompressed,
      data: method === 8 ? inflateRawSync(body) : body,
    });
    offset += 46 + nameLen;
  }
  return entries;
}

function findEocd(zip) {
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

describe('createZip', () => {
  it('writes forward slashes, whatever separator the caller used', () => {
    // The bug this file exists for: Compress-Archive wrote "icons\icon-16.png",
    // and AMO rejects the upload with "Invalid file name in archive".
    const zip = createZip([
      { name: 'icons\\icon-16.png', data: Buffer.from('a') },
      { name: 'lib/roll.mjs', data: Buffer.from('b') },
    ]);

    const names = readCentralDirectory(zip).map((e) => e.name);
    expect(names).toEqual(['icons/icon-16.png', 'lib/roll.mjs']);
    expect(names.some((n) => n.includes('\\'))).toBe(false);
  });

  it('round-trips content, compressed or stored', () => {
    const compressible = Buffer.from('x'.repeat(5000));
    const incompressible = Buffer.from(
      Array.from({ length: 512 }, (_, i) => (i * 167 + 13) % 251)
    );

    const entries = readCentralDirectory(createZip([
      { name: 'big.txt', data: compressible },
      { name: 'noise.bin', data: incompressible },
      { name: 'empty.txt', data: Buffer.alloc(0) },
    ]));

    expect(entries[0].data).toEqual(compressible);
    expect(entries[1].data).toEqual(incompressible);
    expect(entries[2].data).toEqual(Buffer.alloc(0));
  });

  it('falls back to stored when deflating would make a file bigger', () => {
    // foxy.webm is already compressed; deflating it costs bytes for nothing.
    // Real random bytes, because an arithmetic sequence is periodic and deflate
    // eats it - which is exactly what this assertion caught the first time.
    const incompressible = randomBytes(4096);
    const [entry] = readCentralDirectory(createZip([{ name: 'a.bin', data: incompressible }]));
    expect(entry.method).toBe(0);
    expect(entry.data).toEqual(incompressible);
  });

  it('records a correct CRC and uncompressed size for every entry', () => {
    const data = Buffer.from('manifest goes here');
    const [entry] = readCentralDirectory(createZip([{ name: 'manifest.json', data }]));
    expect(entry.sum).toBe(crc32(data));
    expect(entry.uncompressed).toBe(data.length);
  });

  it('produces byte-identical output for identical input', () => {
    // Fixed DOS timestamps - so a rebuild that changed nothing is visibly a
    // rebuild that changed nothing.
    const files = [{ name: 'a.txt', data: Buffer.from('hello') }];
    expect(createZip(files)).toEqual(createZip(files));
  });
});
