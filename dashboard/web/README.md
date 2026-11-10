# web — 수익 대시보드 프론트엔드

Setup and emulator workflow: see `../README.md`.

```bash
npm run dev      # mock login if no .env.local; Firebase emulators if VITE_USE_EMULATORS=true
npm test         # Vitest: money formatting, KST dates, aggregation
npm run build
```

- Auth: `src/app/auth.tsx` (Firebase Google sign-in + allowlist check; mock fallback in `mockAuth.ts`)
- Firebase init: `src/lib/firebase.ts`
- Data flow: `firestoreRaw.ts` (onSnapshot, §4 schema) or `mockRaw.ts` (no Firebase)
  → `aggregate.ts` `buildDashboard()` (pure, unit-tested) → components
- Sample data in Firestore shape: `src/data/seed.ts` (also used by `npm run seed` at the repo root)
- `/login?error=denied` previews the "접근 권한이 없는 계정입니다" state
