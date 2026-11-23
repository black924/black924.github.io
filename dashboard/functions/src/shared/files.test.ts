import { crc32, deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeText, parseCsv, readZip } from './files';

/** Builds a ZIP like Play's: one entry per file, deflate or stored. */
export function makeZip(files: { name: string; data: Buffer; store?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const body = f.store ? f.data : deflateRawSync(f.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(f.store ? 0 : 8, 8);
    lh.writeUInt32LE(crc32(f.data), 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(f.store ? 0 : 8, 10);
    ch.writeUInt32LE(crc32(f.data), 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('readZip', () => {
  it('reads deflated and stored entries', () => {
    const big = Buffer.from('a,b\n'.repeat(5000));
    const zip = makeZip([{ name: 'salesreport_202611.csv', data: big }, { name: 'note.txt', data: Buffer.from('hi'), store: true }]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['salesreport_202611.csv', 'note.txt']);
    expect(entries[0].data.equals(big)).toBe(true);
    expect(entries[1].data.toString()).toBe('hi');
  });
  it('rejects non-zip data', () => {
    expect(() => readZip(Buffer.from('not a zip file at all, definitely not'))).toThrow(/ZIP/);
  });
});

describe('decodeText', () => {
  it('handles UTF-16 LE with and without BOM, UTF-16 BE and UTF-8 BOM', () => {
    const s = 'Order Number,상품';
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]))).toBe(s);
    expect(decodeText(Buffer.from(s, 'utf16le'))).toBe(s);
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(s, 'utf16le').swap16()]))).toBe(s);
    expect(decodeText(Buffer.from('﻿' + s, 'utf8'))).toBe(s);
  });
});

describe('parseCsv', () => {
  it('parses quotes, commas, escaped quotes, CRLF and newlines in fields', () => {
    expect(parseCsv('a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'say "hi"', 'line1\nline2'],
      ['1', '', '3'],
    ]);
  });
});
