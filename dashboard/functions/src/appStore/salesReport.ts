// Pure parts of the App Store Connect daily Sales report (SALES / SUMMARY / DAILY).
// Column meanings: developer.apple.com/help/app-store-connect/reference/reporting/summary-sales-report
//   Units                 aggregated units; negative = refund
//   Developer Proceeds    per unit, customer price minus tax and Apple's commission (positive even for refunds)
//   Currency of Proceeds  currency of Developer Proceeds
//   SKU                   SKU of the app, or of the In-App Purchase
//   Parent Identifier     for In-App Purchases: SKU of the app it belongs to (empty for app rows)
//   Proceeds Reason       "Rate After One Year" when a subscription earns the reduced commission
// Columns are looked up by header name, so report versions that add or reorder columns still parse.

import { decimalToMicros } from '../shared/money';

export { decimalToMicros };

export type SalesKind = 'inapp' | 'paid';

export interface SalesRow {
  appSku: string;
  kind: SalesKind;
  units: number;
  proceedsMicros: number; // per unit
  currency: string; // Currency of Proceeds
  afterOneYear: boolean;
}

const COL = {
  sku: 'SKU',
  parent: 'Parent Identifier',
  units: 'Units',
  proceeds: 'Developer Proceeds',
  currency: 'Currency of Proceeds',
  reason: 'Proceeds Reason',
} as const;

/** Parses the tab-separated report. Rows without proceeds (free downloads, updates) are dropped. */
export function parseSalesReport(tsv: string): SalesRow[] {
  const lines = tsv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  // "Developer Proceeds" is sometimes labelled "Developer Proceeds (per unit)" in Apple's docs.
  const proceedsIdx = header.findIndex((h) => h === COL.proceeds || h.startsWith(`${COL.proceeds} `));
  const need = { sku: idx(COL.sku), parent: idx(COL.parent), units: idx(COL.units), currency: idx(COL.currency) };
  for (const [k, i] of Object.entries({ ...need, proceeds: proceedsIdx })) {
    if (i < 0) throw new Error(`Sales report column missing: ${k}`);
  }
  const reasonIdx = idx(COL.reason);

  const rows: SalesRow[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split('\t').map((v) => v.trim());
    const units = Number(c[need.units]);
    const proceedsMicros = decimalToMicros(c[proceedsIdx] || '0');
    if (!Number.isInteger(units)) throw new Error(`Unexpected units: ${c[need.units]}`);
    if (units === 0 || proceedsMicros === 0) continue;
    const parent = c[need.parent] ?? '';
    rows.push({
      appSku: parent || c[need.sku],
      kind: parent ? 'inapp' : 'paid',
      units,
      proceedsMicros,
      currency: (c[need.currency] || '').toUpperCase(),
      afterOneYear: reasonIdx >= 0 && /after one year/i.test(c[reasonIdx] ?? ''),
    });
  }
  return rows;
}

/**
 * Tax-excluded sale price (the dashboard's "gross") from proceeds: proceeds = price × (1 − commission).
 * Commission is 15% in the Small Business Program and for subscriptions after one year, else 30%.
 */
export function grossFromNet(netMicros: number, opts: { smallBusiness: boolean; afterOneYear: boolean }): number {
  const keepPct = opts.smallBusiness || opts.afterOneYear ? 85n : 70n;
  const n = BigInt(netMicros) * 100n;
  const half = keepPct / 2n;
  return Number(n >= 0n ? (n + half) / keepPct : (n - half) / keepPct);
}

export interface SalesTotal {
  appSku: string;
  kind: SalesKind;
  currency: string;
  netMicros: number;
  grossMicros: number;
}

/** Sums rows per app SKU, kind and proceeds currency. */
export function totalSales(rows: SalesRow[], smallBusiness: boolean): SalesTotal[] {
  const out = new Map<string, SalesTotal>();
  for (const r of rows) {
    const key = `${r.appSku}\t${r.kind}\t${r.currency}`;
    const t = out.get(key) ?? { appSku: r.appSku, kind: r.kind, currency: r.currency, netMicros: 0, grossMicros: 0 };
    const net = r.proceedsMicros * r.units;
    t.netMicros += net;
    t.grossMicros += grossFromNet(net, { smallBusiness, afterOneYear: r.afterOneYear });
    out.set(key, t);
  }
  return [...out.values()];
}
