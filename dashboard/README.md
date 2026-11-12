# HNH Labs 수익 대시보드

See `CLAUDE.md` for architecture and milestones. Live: https://auto-posting-a970b.web.app

Done so far: **1 (UI + mock data)**, **2 (auth)**, **3 (Firestore data)**, **4 (AdMob)**, **5 (Google Play)**, **6 (App Store notifications — needs the App Store Connect setup below)**.

## Local development (emulators, no real project needed)

Requires Node 20+, Firebase CLI, and **JDK 21+** for the emulators
(`brew install openjdk@21`; `scripts/firebase.sh` picks it up automatically).

```bash
npm install && (cd web && npm install)
cp web/.env.example web/.env.local          # VITE_USE_EMULATORS=true

npm run emulators                           # terminal 1: Auth :9099, Firestore :8080, UI :4000
ALLOWED_EMAILS="you@gmail.com" npm run seed # terminal 2: allowlist + ~2 months of sample data
npm run simulate                            # (optional) fake payment every 15–30s, Ctrl+C to stop
cd web && npm run dev                       # terminal 3: http://localhost:5173
```

In the emulator, "Google 계정으로 계속하기" opens a fake account picker: "Add new account" and type any email.
An email that is not in `ALLOWED_EMAILS` is signed out with "접근 권한이 없는 계정입니다".

`npm run seed` wipes the emulator and rewrites everything, so it is safe to re-run (e.g. the next day).
Sample data comes from `web/src/data/seed.ts`; `simulate` writes the same documents the
Play/App Store functions will (transactions + `daily` + `hourly` + `sync`), so the dashboard updates live.

Without `web/.env.local`, the web app falls back to mock login (milestone-1 mode).

## Tests

```bash
npm run test:rules           # Firestore rules; starts its own emulator (stop `npm run emulators` first)
npm run test:rules:running   # same tests against an already running emulator
cd web && npm test           # money, KST dates, dashboard aggregation
```

## How access control works

- `firestore.rules`: reads require a signed-in user with `email_verified == true` whose email (lowercased)
  is in `config/app.allowedEmails`. All client writes are denied; Cloud Functions write via the Admin SDK.
- The web app decides "allowed" by reading `config/app`. Only allowlisted users can read it,
  so the check is enforced by Firestore, not by client code. Denied users are signed out immediately.
- Store emails in `allowedEmails` **lowercased**.

## Real Firebase project

Project: **`auto-posting-a970b`** (reused; Firestore in `asia-northeast3`, Spark plan for now).
Web app "HNH 수익 대시보드" is registered; its config is in `web/.env.production.local` (git-ignored).

```bash
cd web && npm run dev:live                  # local UI, real Firebase login + Firestore
sh scripts/firebase.sh deploy --only firestore:rules
ALLOWED_EMAILS="you@gmail.com" node scripts/set-allowlist.mjs auto-posting-a970b   # uses your gcloud login
node scripts/set-apps.mjs auto-posting-a970b   # upserts web/src/data/apps.json into apps/{id}
```

- Deploying rules replaces the project's previous (blog automation) rules. Old collections
  (`drafts`, `ideas`, `meta`, `requests`, `trends`) were left in place untouched.
- Emulator scripts always use demo project IDs, so they never touch the real project
  (`scripts/emulatorDb.ts` refuses to run unless `FIRESTORE_EMULATOR_HOST` is local).
- `firestore.indexes.json` holds the composite index for the monthly refund query; deploy with
  `sh scripts/firebase.sh deploy --only firestore:indexes`.
- The real project has no revenue data until milestones 4–6, so `npm run dev:live` shows ₩0 and "연결 전".
- Before milestone 4 the project must move to the **Blaze** plan (Functions 2nd gen, Secret Manager, Scheduler).

## AdMob setup (milestone 4)

Functions (region `asia-northeast3`, Node 22): `admobOauthStart`, `admobOauthCallback`, `syncAdmob` (every 30 min).

| Secret (Secret Manager) | Where it comes from | Set by |
|---|---|---|
| `ADMOB_OAUTH_CLIENT_ID` | Google Cloud console → Google Auth Platform → Clients → Web client ID | `firebase functions:secrets:set` |
| `ADMOB_OAUTH_CLIENT_SECRET` | same client → Client secret | `firebase functions:secrets:set` |
| `ADMOB_REFRESH_TOKEN` | written by `admobOauthCallback` after you click "AdMob 연결" | the function (never by hand) |

One-time steps (project `auto-posting-a970b`):

1. Grant the Functions runtime service account access to the refresh-token secret:
   ```bash
   for R in roles/secretmanager.secretAccessor roles/secretmanager.secretVersionManager; do
     gcloud secrets add-iam-policy-binding ADMOB_REFRESH_TOKEN --project auto-posting-a970b \
       --member="serviceAccount:80162414599-compute@developer.gserviceaccount.com" --role=$R
   done
   ```
2. Google Cloud console → **Google Auth Platform**:
   - Branding: app name (e.g. "HNH 수익 대시보드"), support email.
   - Audience: **External**, then **Publish app** (In production). In "Testing", refresh tokens expire after 7 days.
   - Data access: add scope `https://www.googleapis.com/auth/admob.readonly`.
3. Clients → **Create client** → Web application. Authorized redirect URI:
   `https://asia-northeast3-auto-posting-a970b.cloudfunctions.net/admobOauthCallback`
4. Store the client values (prompts for the value):
   ```bash
   firebase functions:secrets:set ADMOB_OAUTH_CLIENT_ID --project auto-posting-a970b
   firebase functions:secrets:set ADMOB_OAUTH_CLIENT_SECRET --project auto-posting-a970b
   ```
5. Deploy: `sh scripts/firebase.sh deploy --only functions --project auto-posting-a970b`
6. Dashboard (`npm run dev:live`) → 데이터 연동 상태 → **AdMob 연결**, sign in with the Google account that owns AdMob
   (it must also be on the allowlist). The first sync runs immediately.

If the AdMob account's reporting time zone is not Seoul, the sync card shows a warning; change it in AdMob settings.

## Google Play setup (milestone 5)

Functions: `onPlayRtdn` (Pub/Sub topic `play-rtdn`, retried on failure, duplicate-safe), `syncFx` (daily 07:00 KST, Frankfurter).
No secrets: the Play API is called as the Functions runtime service account `80162414599-compute@developer.gserviceaccount.com`.

1. Let Google Play publish to the topic:
   ```bash
   gcloud pubsub topics add-iam-policy-binding play-rtdn --project auto-posting-a970b \
     --member="serviceAccount:google-play-developer-notifications@system.gserviceaccount.com" --role=roles/pubsub.publisher
   ```
2. Play Console → **Users and permissions** → **Invite new users** → email `80162414599-compute@developer.gserviceaccount.com`
   → Account permissions: **View financial data, orders, and cancellation survey responses** and **Manage orders and subscriptions** → Invite.
3. For each app: **Monetize with Play → Monetization setup → Real-time developer notifications**
   → Enable, Topic name `projects/auto-posting-a970b/topics/play-rtdn`,
   Notification content **Get all notifications for subscriptions and one-time products** → **Save changes** → **Send test notification**.

A test notification shows up as `sync/google_play.lastTestAt`. Test purchases (license testers) show in the live feed tagged "테스트" but are never added to revenue.
Amounts: gross = order total − tax (net is stored too), converted to KRW with the `fx` rate of the payment date (KST).

## App Store setup (milestone 6)

Function: `appStoreWebhook` (HTTPS). No secrets: payloads are verified with Apple's public root certificate
(`functions/certs/AppleRootCA-G3.cer`, SHA-256 `63:34:3A:BF:…:3E:91:79`, from apple.com/certificateauthority).

1. Deploy, then sync the app list so notifications map to apps (`appStoreBundleId` in `web/src/data/apps.json`):
   ```bash
   sh scripts/firebase.sh deploy --only functions:appStoreWebhook --project auto-posting-a970b
   node scripts/set-apps.mjs auto-posting-a970b
   ```
2. App Store Connect → each iOS app → **App Information** → **App Store Server Notifications**:
   Production Server URL and Sandbox Server URL both
   `https://asia-northeast3-auto-posting-a970b.cloudfunctions.net/appStoreWebhook`, **Version 2** → Save.
3. Make a sandbox purchase (Sandbox Apple Account or TestFlight). It shows in the live feed tagged "테스트"
   and is never added to revenue. Apple's TEST notification (App Store Server API `requestTestNotification`)
   needs an API key, so it is optional; it shows up as `sync/app_store.lastTestAt`.

Amounts are the App Store Connect price (`price` milliunits × 1000, may include VAT) converted to KRW at the
payment date's `fx` rate. Paid-app downloads send no notification; they come from the Sales report (milestone 7).

## Deploy

```bash
sh scripts/firebase.sh deploy --only hosting,firestore --project auto-posting-a970b   # web (builds web/ first) + rules/indexes
sh scripts/firebase.sh deploy --only functions --project auto-posting-a970b --force   # --force: onPlayRtdn has a retry policy
```

The web build uses `web/.env.production.local` (real project config, git-ignored).
Caching: every path is `no-cache` except hashed files under `/assets/` (1 year, immutable).
