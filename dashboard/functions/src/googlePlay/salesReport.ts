// Pure parts of the Google Play Sales report (gs://<bucket>/sales/salesreport_YYYYMM.zip, monthly CSV).
// Columns: support.google.com/googleplay/android-developer/answer/6135870
//   Order Charged Timestamp  UNIX seconds
//   Financial Status         "charged", "refund", "partial refund", ...
//   Package ID               app package name
//   Product Type             "Subscription", "One-time product", "Paid app"
//   Currency of Sale, Item Price (tax excluded), Taxes Collected, Charged Amount (= item price + taxes)
// Columns are looked up by header name (Google warns the column count can change).
import { kstDateKey } from '../shared/kst';
import { decimalToMicros } from '../shared/money';

export interface PlaySale {
  date: string; // KST
  pkg: string;
  kind: 'inapp' | 'paid';
  currency: string;
  grossMicros: number; // tax excluded, Google fee included; negative for refunds
}

export interface PlaySalesParse {
  sales: PlaySale[];
  latestAt: Date | null; // newest Order Charged Timestamp in the file
  skippedStatuses: Record<string, number>;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, '');

export function parsePlaySales(rows: string[][]): PlaySalesParse {
  const out: PlaySalesParse = { sales: [], latestAt: null, skippedStatuses: {} };
  if (rows.length === 0) return out;
  const header = rows[0].map(norm);
  const col = (...names: string[]) => {
    const i = header.findIndex((h) => names.map(norm).includes(h));
    return i;
  };
  const c = {
    ts: col('Order Charged Timestamp'),
    status: col('Financial Status'),
    pkg: col('Package ID', 'Product ID'),
    type: col('Product Type'),
    currency: col('Currency of Sale'),
    price: col('Item Price'),
    tax: col('Taxes Collected'),
    charged: col('Charged Amount'),
  };
  for (const [k, i] of Object.entries(c)) {
    if (i < 0 && k !== 'tax' && k !== 'charged') throw new Error(`Play sales report column missing: ${k}`);
  }

  for (const r of rows.slice(1)) {
    const v = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const secs = Number(v(c.ts));
    if (!Number.isFinite(secs) || secs <= 0) continue;
    const at = new Date(secs * 1000);
    if (!out.latestAt || at > out.latestAt) out.latestAt = at;

    const status = norm(v(c.status));
    let sign: 1 | -1;
    if (status === 'charged') sign = 1;
    else if (status.includes('refund')) sign = -1;
    else {
      out.skippedStatuses[v(c.status) || '(blank)'] = (out.skippedStatuses[v(c.status) || '(blank)'] ?? 0) + 1;
      continue;
    }
    // Item Price is tax excluded; fall back to Charged Amount − Taxes Collected.
    const priceText = v(c.price);
    const micros = priceText !== ''
      ? decimalToMicros(priceText)
      : decimalToMicros(v(c.charged) || '0') - decimalToMicros(v(c.tax) || '0');
    // TODO(verify): Google doesn't say whether refund rows carry negative amounts; normalize either way.
    const gross = sign * Math.abs(micros);
    if (gross === 0) continue;
    out.sales.push({
      // TODO(verify): for refund rows, whether the timestamp is the refund time or the original charge time.
      date: kstDateKey(at),
      pkg: v(c.pkg),
      kind: norm(v(c.type)) === 'paidapp' ? 'paid' : 'inapp',
      currency: v(c.currency).toUpperCase(),
      grossMicros: gross,
    });
  }
  return out;
}
