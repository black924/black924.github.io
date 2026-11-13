// Money values are integer KRW micros unless the field says otherwise.

export type Period = 'today' | 'yesterday' | '7d' | 'month';
export type Platform = 'android' | 'ios';
export type Store = 'google' | 'apple';
export type DataStatus = 'estimated' | 'final';

// ---------- Firestore documents (CLAUDE.md §4) ----------

export interface AppInfo {
  id: string;
  name: string;
  platform: Platform[];
  iconColor: string;
  iconUrl?: string;
  admobAppId?: string;
  playPackage?: string;
  appStoreAppId?: string;
  appStoreBundleId?: string; // matches App Store notifications to the app
}

export interface StoreAmounts {
  google: number;
  apple: number;
}

/** Raw counts per ad unit; rates (match/show rate, eCPM) are computed for display, never summed. */
export interface AdUnitStats {
  name: string;
  platform: Platform | ''; // '' = unknown (synced before platforms were recorded)
  format: string;
  requests: number;
  matchedRequests: number;
  impressions: number;
  clicks: number;
  earningsMicros: number;
}

export interface DailyDoc {
  date: string; // YYYY-MM-DD (KST)
  appId: string;
  ad: {
    totalMicros: number;
    bySource: { admob: number; unity: number; other: number };
    units?: Record<string, AdUnitStats>;
  };
  inapp: StoreAmounts;
  paid: StoreAmounts;
  status: DataStatus;
}

export interface HourlyDoc {
  date: string;
  hour: number; // 0-23 KST
  ad: number;
  inapp: number;
  paid: number;
}

export interface Transaction {
  id: string;
  store: Store;
  appId: string;
  productId: string;
  productName: string;
  type: 'subscription' | 'inapp' | 'paid' | 'refund';
  amountMicros: number; // original currency; negative for refunds
  currency: string;
  amountKrwMicros: number; // negative for refunds
  occurredAt: Date;
  source: 'rtdn' | 'asn' | 'report';
  test: boolean; // license-tester purchase: in the feed only, never in revenue
}

export type SyncSource = 'admob' | 'google_play' | 'app_store' | 'reconcile';

export interface SyncDoc {
  source: SyncSource;
  state: 'ok' | 'error' | 'scheduled';
  lastRunAt: Date;
  lastError?: string;
  warning?: string;
}

export interface FxDoc {
  date: string;
  rates: Record<string, number>; // KRW per 1 unit
}

export interface AppConfig {
  revenueBasis: 'gross' | 'net';
}

/** Everything the dashboard reads, before aggregation. */
export interface RawData {
  config: AppConfig | null;
  apps: AppInfo[];
  daily: DailyDoc[]; // covers dailyWindow()
  hourly: HourlyDoc[]; // today and yesterday
  transactions: Transaction[]; // latest first
  refundsThisMonth: Transaction[];
  subscribers: Partial<Record<Store, number>>;
  sync: SyncDoc[];
  fx: FxDoc | null;
}

// ---------- View model ----------

export interface Split {
  ad: number;
  inapp: number;
  paid: number;
}

export interface Bucket extends Split {
  key: string;
  label: string; // axis label
  title: string; // readout label
  partial: boolean; // still being aggregated
  future: boolean; // not reached yet (only the comparison bar is drawn)
  status: DataStatus;
  prev: number | null; // comparison period total; null = no data for that window
  prevSplit: Split | null; // the same, per revenue type (null exactly when prev is null)
  prevTitle: string;
}

export interface SyncInfo {
  source: SyncSource;
  state: SyncDoc['state'] | 'pending'; // pending = never synced
  lastRunAt?: Date;
  lastError?: string;
  warning?: string;
}

export interface StoreSummary {
  amount: number;
  activeSubscribers: number | null;
  refundCount: number;
  refundMicros: number; // positive amount refunded
}

export interface AdUnitRow extends AdUnitStats {
  key: string;
}

export interface AppRow extends Split {
  app: AppInfo;
  stores: Record<Store, number>; // in-app + paid per store
  adUnits: AdUnitRow[]; // summed over the period, highest earnings first
  /** Same numbers for the comparison window (same elapsed time); null = no data for this app then. */
  prev: { ad: number; stores: Record<Store, number>; adUnits: AdUnitRow[] } | null;
}

export interface DashboardData {
  period: Period;
  now: Date;
  buckets: Bucket[];
  totals: Split;
  previousTotal: number;
  compareLabel: string;
  prevLabel: string; // legend name of the grey comparison bars
  hasEstimated: boolean;
  adSources: { admob: number; unity: number; other: number };
  stores: Record<Store, StoreSummary>;
  appRows: AppRow[];
  appsById: Record<string, AppInfo>;
  transactions: Transaction[];
  sync: SyncInfo[];
  lastSyncAt: Date | null;
  fx: FxDoc | null;
  revenueBasis: 'gross' | 'net';
}
