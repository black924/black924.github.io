import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ascToken } from './connect';
import { decimalToMicros, grossFromNet, parseSalesReport, totalSales } from './salesReport';

const HEADER = [
  'Provider', 'Provider Country', 'SKU', 'Developer', 'Title', 'Version', 'Product Type Identifier', 'Units',
  'Developer Proceeds', 'Begin Date', 'End Date', 'Customer Currency', 'Country Code', 'Currency of Proceeds',
  'Apple Identifier', 'Customer Price', 'Promo Code', 'Parent Identifier', 'Subscription', 'Period', 'Category',
  'CMB', 'Device', 'Supported Platforms', 'Proceeds Reason', 'Preserved Pricing', 'Client', 'Order Type',
];

function row(v: { sku: string; type: string; units: number; proceeds: string; cur: string; parent?: string; reason?: string }) {
  const r = Object.fromEntries(HEADER.map((h) => [h, '']));
  Object.assign(r, {
    SKU: v.sku, 'Product Type Identifier': v.type, Units: String(v.units), 'Developer Proceeds': v.proceeds,
    'Currency of Proceeds': v.cur, 'Parent Identifier': v.parent ?? '', 'Proceeds Reason': v.reason ?? '',
  });
  return HEADER.map((h) => r[h]).join('\t');
}

const tsv = (...rows: string[]) => [HEADER.join('\t'), ...rows].join('\n') + '\n';

describe('decimalToMicros', () => {
  it('parses without floats', () => {
    expect(decimalToMicros('0.70')).toBe(700_000);
    expect(decimalToMicros('1234')).toBe(1_234_000_000);
    expect(decimalToMicros('-2.5')).toBe(-2_500_000);
    expect(decimalToMicros('1,100.1234565')).toBe(1_100_123_457);
    expect(decimalToMicros('.5')).toBe(500_000);
  });
  it('rejects junk', () => {
    expect(() => decimalToMicros('abc')).toThrow();
    expect(() => decimalToMicros('')).toThrow();
  });
});

describe('grossFromNet', () => {
  it('undoes the commission', () => {
    expect(grossFromNet(700_000, { smallBusiness: false, afterOneYear: false })).toBe(1_000_000);
    expect(grossFromNet(850_000, { smallBusiness: true, afterOneYear: false })).toBe(1_000_000);
    expect(grossFromNet(850_000, { smallBusiness: false, afterOneYear: true })).toBe(1_000_000);
    expect(grossFromNet(-700_000, { smallBusiness: false, afterOneYear: false })).toBe(-1_000_000);
  });
});

describe('parseSalesReport / totalSales', () => {
  const report = tsv(
    row({ sku: 'NOISE', type: '1F', units: 12, proceeds: '0', cur: 'USD' }), // free downloads: dropped
    row({ sku: 'noise.pro.monthly', type: 'IAY', units: 3, proceeds: '1.70', cur: 'USD', parent: 'NOISE' }),
    row({ sku: 'noise.pro.monthly', type: 'IAY', units: 1, proceeds: '1.70', cur: 'USD', parent: 'NOISE', reason: 'Rate After One Year' }),
    row({ sku: 'noise.pro.monthly', type: 'IAY', units: -1, proceeds: '1.70', cur: 'USD', parent: 'NOISE' }), // refund
    row({ sku: 'noise.lifetime', type: 'IA1', units: 2, proceeds: '3080', cur: 'KRW', parent: 'NOISE' }),
    row({ sku: 'PAIDAPP', type: '1', units: 1, proceeds: '0.70', cur: 'EUR' }),
    row({ sku: 'NOISE', type: '7F', units: 5, proceeds: '0', cur: 'USD' }), // updates: dropped
  ).replace(/\n/g, '\r\n');

  it('keeps only rows that move money and maps IAPs to their app', () => {
    const rows = parseSalesReport(report);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ appSku: 'NOISE', kind: 'inapp', units: 3, proceedsMicros: 1_700_000, currency: 'USD' });
    expect(rows[1].afterOneYear).toBe(true);
    expect(rows[4]).toMatchObject({ appSku: 'PAIDAPP', kind: 'paid' });
  });

  it('sums per app, kind and currency; refunds subtract', () => {
    const t = totalSales(parseSalesReport(report), false);
    const usd = t.find((x) => x.appSku === 'NOISE' && x.currency === 'USD')!;
    expect(usd.netMicros).toBe(1_700_000 * 3); // 3 + 1 − 1 units
    // +3 and −1 units at 70% keep, 1 unit after one year at 85%
    expect(usd.grossMicros).toBe(7_285_714 - 2_428_571 + 2_000_000); // each row rounded on its own
    const krw = t.find((x) => x.currency === 'KRW')!;
    expect(krw).toMatchObject({ kind: 'inapp', netMicros: 6_160_000_000, grossMicros: 8_800_000_000 });
    expect(t.find((x) => x.appSku === 'PAIDAPP')).toMatchObject({ kind: 'paid', grossMicros: 1_000_000 });
  });

  it('fails loudly when a needed column is missing', () => {
    expect(() => parseSalesReport('SKU\tUnits\nA\t1\n')).toThrow(/column missing/);
  });

  it('accepts the "(per unit)" header label and an empty report', () => {
    const alt = report.replace('Developer Proceeds', 'Developer Proceeds (per unit)');
    expect(parseSalesReport(alt)).toHaveLength(5);
    expect(parseSalesReport('')).toEqual([]);
  });
});

describe('ascToken', () => {
  it('builds an ES256 JWT Apple can verify', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const now = Date.UTC(2026, 10, 23);
    const jwt = ascToken({ keyId: 'KEY123', issuerId: 'issuer-uuid', privateKey: pem.replace(/\n/g, '\\n') }, now);
    const [h, p, s] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123', typ: 'JWT' });
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toMatchObject({ iss: 'issuer-uuid', aud: 'appstoreconnect-v1', iat: now / 1000 });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(20 * 60);
    const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    expect(ok).toBe(true);
  });
});
