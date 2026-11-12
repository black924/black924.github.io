# 앱 수익 대시보드 (HNH Labs)

개발자 본인 전용 웹 대시보드. 구글 로그인 후 **AdMob 광고 수익(Unity Ads 미디에이션 포함)**, **Google Play / App Store의 인앱·구독·유료앱 결제 금액**을 한 화면에서 본다.

이 문서는 Claude Code가 이 저장소에서 작업할 때 따르는 기준이다. 결정이 바뀌면 이 문서를 먼저 고친다.

---

## 1. 핵심 원칙

1. **브라우저는 Firestore에 저장된 데이터만 읽는다.** 외부 API(AdMob, Play, App Store)는 서버(Cloud Functions)만 호출한다.
2. **키·토큰은 서버에만 둔다.** OAuth refresh token, 서비스 계정 키, App Store `.p8` 키는 Secret Manager에 보관한다. 프론트 코드, `.env`, Git에 절대 넣지 않는다.
3. **본인 계정만 접속 가능.** 허용 이메일 목록(allowlist)으로 막고, Firestore 보안 규칙에서도 같은 조건을 건다.
4. **2층 구조로 데이터를 다룬다.**
   - 실시간 층: 결제 알림(웹훅)과 AdMob 폴링 → 금액을 "추정치(estimated)"로 즉시 기록
   - 보정 층: 하루 1회 공식 리포트 → 같은 날짜 데이터를 "확정치(final)"로 덮어쓰기
5. **Unity Ads는 따로 연동하지 않는다.** AdMob 미디에이션 리포트에 이미 포함되어 있어서, Unity API를 붙이면 이중 집계된다. (나중에 정산 비교용으로만 추가 가능)

---

## 2. 기술 스택

| 영역 | 선택 |
|---|---|
| 프론트 | React + Vite + TypeScript |
| 스타일 | CSS Modules 또는 Tailwind (디자인 토큰은 아래 7장) |
| 차트 | 직접 만든 SVG/div 막대 + 도넛 (가벼운 라이브러리 사용 시 Recharts 허용) |
| 인증 | Firebase Authentication — Google 로그인 |
| DB | Cloud Firestore |
| 서버 | Cloud Functions for Firebase (2nd gen, **Node 22**, TypeScript, 리전 `asia-northeast3`). Node 20은 2026-10-30 지원 종료 |
| 예약 작업 | Cloud Scheduler (Functions `onSchedule`) |
| 비밀값 | Google Secret Manager (`defineSecret`) |
| 호스팅 | Firebase Hosting |
| 시간대 | 모든 날짜 집계 기준은 `Asia/Seoul` |
| Firebase 프로젝트 | `auto-posting-a970b` (기존 프로젝트 재사용, Firestore `asia-northeast3`). 에뮬레이터는 `demo-hnh-dashboard` |

---

## 3. 데이터 출처와 연동 방법

### 3-1. AdMob (광고, Unity 미디에이션 포함)
- API: **AdMob API v1**
  - `accounts.mediationReport.generate` → 광고 소스(ad source)별 수익 (AdMob 네트워크 / Unity Ads / 기타)
  - `accounts.networkReport.generate` → 필요 시 AdMob 자체 네트워크 상세
- 인증: OAuth 2.0, 스코프 `https://www.googleapis.com/auth/admob.readonly`
  - Firebase 로그인 토큰으로는 서버가 계속 호출할 refresh token을 얻기 어렵다. **최초 1회 연결용 OAuth 플로우**(Functions `admobOauthStart` → `admobOauthCallback`)로 받은 refresh token을 Secret Manager `ADMOB_REFRESH_TOKEN`에 저장한다. 콜백은 allowlist 계정만 받아들인다.
  - refresh token은 재연결 때마다 바뀌므로 `defineSecret`(재배포해야 반영)이 아니라 **실행 시 Secret Manager API로 읽는다.** OAuth 클라이언트 ID/시크릿은 `defineSecret`.
  - OAuth 동의 화면이 "테스트" 상태면 refresh token이 7일 뒤 만료된다. 본인만 쓰더라도 **게시 상태를 "프로덕션"**으로 둔다(검증 없이 사용 가능, 미확인 앱 경고만 표시).
- 차원(dimensions): `DATE`, `APP`, `AD_SOURCE`. **`HOUR` 차원은 없다** → 오늘의 시간대별 광고 막대는 폴링 사이 오늘 누적액의 증가분을 현재 시(KST)에 더해 근사한다(하루 첫 폴링은 경과 시간에 균등 분배).
- 리포트 날짜는 AdMob 계정의 `reportingTimeZone` 기준(`timeZone` 지정은 America/Los_Angeles만 허용). 서울이 아니면 연동 상태 카드에 경고를 띄운다.
- 앱 매칭: `accounts.apps.list`의 `linkedAppInfo.appStoreId`(Android 패키지명 / iOS 숫자 ID)를 `apps`의 `playPackage`/`appStoreAppId`와 맞춘다. 매칭 안 된 AdMob 앱은 `admob_{id}`로 따로 보인다.
- 지표(metrics): `ESTIMATED_EARNINGS` (`localizationSettings.currencyCode: "KRW"`로 원화 micros 수신)
- 광고 단위 리포트(별도 호출): 차원 `DATE`, `AD_UNIT`(APP 자동 포함), `FORMAT` / 지표 `AD_REQUESTS`, `MATCHED_REQUESTS`, `IMPRESSIONS`, `CLICKS`, `ESTIMATED_EARNINGS` → `daily.ad.units`
  - 일치율 = matchedRequests / requests, 노출률 = impressions / matchedRequests, eCPM = earnings / impressions × 1000
- 주기: **30분마다** 오늘·어제 데이터 재조회, 결과로 해당 날짜 문서를 덮어쓴다. (AdMob 웹페이지와 같은 수준의 준실시간)
- 금액은 micros 단위로 내려온다 → 정수 micros로 저장하고 화면에서만 변환.

### 3-2. Google Play (인앱·구독·유료앱)
- 실시간: **Real-time Developer Notifications (RTDN)** → Pub/Sub 토픽 → `onMessagePublished` Function
  - 알림에는 금액이 없다. `purchaseToken`으로 주문 번호를 찾고, **금액은 Orders API `orders.get`**에서 얻는다
    - 구독: `purchases.subscriptionsv2.get` → `lineItems[].latestSuccessfulOrderId`
    - 인앱: `purchases.products.get` → `orderId` (`purchaseState` 0만). `purchaseType` 0(테스트)·구독 `testPurchase`는 `test: true`로 피드에만 기록하고 `daily`·`hourly`에는 더하지 않는다 (테스트 주문의 금액을 못 받으면 0원으로 기록)
    - 주문: `orders.get` → `total`, `tax`, `developerRevenueInBuyerCurrency`, `createTime`, 환불은 `orderHistory.refundEvent`/`partialRefundEvents`
  - 매출로 기록하는 알림: 구독 1 RECOVERED · 2 RENEWED · 4 PURCHASED, 인앱 1 PURCHASED, `voidedPurchaseNotification`(환불, 음수)
  - 금액 기준: **gross = total − tax** (세금 제외, 스토어 수수료 포함). net(`developerRevenueInBuyerCurrency`)도 거래에 함께 저장
  - Pub/Sub 토픽 `play-rtdn`, 함수는 `retry: true`. 401/403/5xx는 재시도, 잘못된 토큰(400/404)은 오류 기록 후 종료
  - Play API 인증: Functions 런타임 서비스 계정을 Play Console 사용자로 초대(재무 데이터 보기, 주문·구독 관리 권한), 스코프 `androidpublisher`
- 확정(보정): Play Console **재무 리포트(Cloud Storage 버킷 `pubsite_prod_...`)**의 `earnings` / `sales` CSV를 매일 읽어 확정 금액으로 덮어쓰기
- 인증: 서비스 계정 (Play Console에서 권한 부여)
- 유료앱(다운로드 결제)은 RTDN이 오지 않으므로 **보정 층에서만** 집계된다.

### 3-3. App Store (인앱·구독·유료앱)
- 실시간: **App Store Server Notifications V2** → HTTPS Function (`/webhooks/appstore`)
  - `signedPayload`(JWS)는 반드시 Apple 인증서 체인으로 **서명 검증** 후 처리 (`@apple/app-store-server-library` 사용)
  - 처리 이벤트: `SUBSCRIBED`, `DID_RENEW`, `ONE_TIME_CHARGE`, `REFUND`, `DID_FAIL_TO_RENEW`, `EXPIRED`
- 확정(보정): **App Store Connect API — Sales and Trends 리포트**(일간 SALES), 필요 시 Finance 리포트
  - 보통 하루 늦게 나온다.
- 인증: App Store Connect API 키(`.p8`, Key ID, Issuer ID) → Secret Manager

### 3-4. 환율
- 기준 통화: KRW. 원 통화 금액도 함께 저장한다.
- 환율 출처: **Frankfurter v2** (`https://api.frankfurter.dev/v2/rates?base=usd`, 키 불필요). `syncFx`가 매일 07:00 KST에 받아 `fx/{YYYY-MM-DD}`에 "1 단위당 KRW"로 저장. 응답은 `[{date, base, quote, rate}]` 배열
- 원화 환산은 결제일(KST) 기준 가장 최근 `fx` 문서(최대 10일 전까지)를 쓰고, 없으면 즉시 받아 저장한다. 환산은 정수 연산(BigInt)으로 한다
- 표시 기준은 설정값 `revenueBasis: "gross" | "net"`. 기본 `gross` = **세금 뺀 판매액(수수료 미차감)**

---

## 4. Firestore 데이터 모델

```
config/app
  allowedEmails: string[]
  timezone: "Asia/Seoul"
  revenueBasis: "gross" | "net"
  baseCurrency: "KRW"

apps/{appId}
  name, platform: ("android"|"ios")[], admobAppIds?: string[], playPackage?, appStoreAppId?, iconColor, iconUrl?
  // 앱 목록 원본: web/src/data/apps.json → scripts/set-apps.mjs 로 반영. iconUrl은 hnh-labs.com/assets/apps/*.png

daily/{YYYY-MM-DD}_{appId}
  date, appId
  ad:     { totalMicros, bySource: { admob, unity, other },     // KRW micros
            units?: { [adUnitKey]: { name, format, platform: "android"|"ios"|"", requests, matchedRequests, impressions, clicks, earningsMicros } } }
            // 광고 단위별 원본 카운트. 일치율·노출률·eCPM은 비율이라 합산하지 않고 화면에서 계산한다
  inapp:  { google, apple }                                   // KRW micros
  paid:   { google, apple }                                   // KRW micros
  status: "estimated" | "final"
  updatedAt

hourly/{YYYY-MM-DD}_{HH}            // 오늘·어제 화면의 시간대별 차트용 (최근 3일만 유지)
  date, hour (0-23)                   // 날짜 범위 조회용
  ad, inapp, paid                     // KRW micros 합계

transactions/{id}                   // 실시간 결제 피드
  store: "google"|"apple", appId, productId, productName
  type: "subscription"|"inapp"|"paid"|"refund"
  amountMicros, currency, amountKrwMicros            // gross (세금 제외)
  netMicros?, netKrwMicros?, orderId?
  occurredAt, source: "rtdn"|"asn"|"report"
  test?: true                                       // 라이선스 테스터 결제: 피드에만 표시, 수익·환불 집계 제외

rtdnEvents/{messageId}              // Play 알림 중복 처리 방지 (처리 완료 표시)
  receivedAt, txId

subscribers/{store}                 // google | apple — 스토어별 결제 카드의 활성 구독자 수
  active: number, updatedAt

sync/{source}                       // admob | google_play | app_store | reconcile
  state: "ok"|"error"|"scheduled", lastRunAt, lastError?, warning?
  // admob 전용: connected, hourlyBase {date, totalMicros}, account {publisherId, reportingTimeZone, currencyCode}

fx/{YYYY-MM-DD}
  USD, JPY, ... (1 단위당 KRW)
```

- 보안 규칙: 읽기는 `request.auth.token.email in get(/config/app).allowedEmails` 이고 `email_verified == true`일 때만. **쓰기는 클라이언트 전부 금지** (Functions는 Admin SDK로 씀).
- 같은 날짜를 다시 받아도 결과가 같도록(멱등) 문서 ID를 날짜·앱 기준으로 고정한다.
- 결제 알림은 `notificationUUID` / `messageId`로 중복 처리 방지.
- 환불(`type: "refund"`)의 `amountMicros`·`amountKrwMicros`는 음수로 저장한다.
- 웹은 `daily`를 `date` 범위(지난달 1일 또는 D-13 중 이른 날 ~ 오늘)로 한 번에 구독하고, 기간 토글은 클라이언트에서 집계한다.

---

## 5. Cloud Functions 목록

| 이름 | 트리거 | 역할 |
|---|---|---|
| `admobOauthStart` / `admobOauthCallback` | HTTPS | 최초 1회 AdMob 연결, refresh token 저장 |
| `syncAdmob` | 스케줄 30분 | 오늘·어제 미디에이션 리포트 → `daily`, `hourly` |
| `requestSync` | Callable (HTTPS) | 헤더 새로고침 버튼. allowlist·이메일 인증 재확인 후 AdMob 동기화 즉시 실행. 직전 실행 60초 이내면 건너뜀 |
| `onPlayRtdn` | Pub/Sub | Play 결제 알림 → `transactions`, `daily`(estimated) |
| `appStoreWebhook` | HTTPS | ASN V2 서명 검증 → `transactions`, `daily`(estimated) |
| `reconcileDaily` | 스케줄 매일 04:00 KST | Play 재무 리포트 + App Store Sales 리포트로 D-1~D-3 확정 |
| `syncFx` | 스케줄 매일 | 환율 저장 |

공통: 실패 시 `sync/{source}`에 에러 기록, 재시도 가능하게 작성. 로그에 토큰·결제 원문을 남기지 않는다.

---

## 6. 화면 (디자인 시안 기준)

### 6-1. 로그인 `/login`
- **누구나 볼 수 있는 화면이므로 수익·앱·연동 소스 관련 내용을 노출하지 않는다.** 관리자 콘솔 입구로만 보이게 한다
- 중앙 카드: HNH 로고 마크 + "ADMIN · RESTRICTED" 표시, 제목 "HNH Labs 관리자 콘솔", 안내 "승인된 관리자 계정으로 로그인하세요."
- 흰색 "Google 계정으로 로그인" 버튼, 하단에 자물쇠 아이콘과 "이 페이지는 관리자 전용입니다. 승인되지 않은 계정은 접속할 수 없습니다."
- allowlist에 없는 계정 → 로그아웃 후 "접근 권한이 없는 계정입니다" 표시
- 브라우저 탭 제목은 "HNH Labs Admin" (로그인 후에도 동일). `noindex, nofollow` 메타 + `robots.txt` 전체 차단

### 6-2. 대시보드 `/`
위에서 아래 순서:
1. **헤더**: 로고·"수익 대시보드"·날짜 / LIVE 점(깜빡임) + "HH:MM 동기화" + 새로고침 아이콘 버튼(누르면 `requestSync`, 도는 동안 아이콘 회전) / 기간 토글 `오늘 | 어제 | 7일 | 이번 달` / 계정 pill + 로그아웃 아이콘 버튼
2. **히어로 카드(넓게)**: 기간 총수익(56px 숫자) + 증감 칩(▲/▼ %) + 비교 기준 문구 / 오른쪽에 광고·인앱·구독·유료앱 KPI 3개 / 그 아래 **누적 막대 차트**(아래부터 광고·인앱·유료앱) + 마우스 올린 막대의 항목별 금액을 보여주는 표시줄. 오늘·어제=시간대별(0~23시), 7일=일별, 이번 달=이달 전체 일자. 집계 중인 막대는 "(집계 중)"
   - **비교 막대(회색)**: 각 막대 왼쪽에 비교 기간 합계를 회색으로 함께 그린다. 오늘↔어제 같은 시, 어제↔그제 같은 시, 7일↔이전 7일 같은 순번, 이번 달↔지난달 같은 일. 아직 오지 않은 시간·날짜는 회색만 보인다
3. **오른쪽 열**: 수익 구성 도넛(가운데 광고 비중 %) + 범례 / **실시간 결제 피드**(최근 4~10건, 스토어 마크 GP/AS, 앱·상품·금액·몇 분 전)
4. **3열 카드**: 광고 소스별(AdMob 네트워크·Unity Ads·기타 막대 + "Unity는 별도 합산 안 함" 안내) / 스토어별 결제(Google Play·App Store + 활성 구독자·이번 달 환불) / 데이터 연동 상태(소스별 상태 점, 방식, 마지막 갱신)
5. **앱별 수익 표**: 앱(아이콘 마크·이름·플랫폼) / 광고 / 인앱·구독 / 유료앱 / 합계 / 비중 막대. 좁은 화면에서는 가로 스크롤
   - 앱 행을 누르면 펼쳐져서 광고 단위별 표(형식·요청·일치율·노출·노출률·eCPM·수익)와 스토어별 결제를 보여준다
   - 펼친 영역은 `전체 | Android | iOS` 탭으로 나눈다(플랫폼이 둘 이상인 앱만). 광고 단위 플랫폼은 AdMob 앱의 `platform`에서 온다
6. **하단 안내**: 환율 가정, 수수료 기준, 오늘 수치는 추정치라는 문구

- `status: "estimated"` 데이터는 숫자 옆에 작은 "추정" 표시 또는 흐린 처리
- Firestore `onSnapshot`으로 구독해서 새 결제가 들어오면 새로고침 없이 반영
- 반응형: 1280px 이상 2열, 그 아래는 카드가 한 줄씩 쌓임. 모바일 폭에서 가로 스크롤이 생기면 안 됨 (표 영역 제외)

---

## 7. 디자인 토큰 (다크 테마)

```css
:root {
  --bg:            #07080B;  /* 페이지 배경 */
  --surface:       #0F1218;  /* 카드 */
  --surface-sunk:  #0A0C11;  /* 카드 안 작은 박스 */
  --border:        #1E232D;
  --divider:       #1A1F28;  /* 목록 구분선, 막대 트랙 */
  --text:          #ECEFF4;
  --text-2:        #C9CFDA;
  --text-3:        #A8B0BE;
  --text-muted:    #8A93A3;
  --text-faint:    #7D8696;  /* 이보다 어두운 글자색 금지 (대비 4.5:1) */

  --ad:            #4F7DFF;  /* 광고 */
  --ad-light:      #8EAEFF;  /* Unity, App Store 보조 */
  --inapp:         #FFB547;  /* 인앱·구독, Google Play */
  --paid:          #3DD6C4;  /* 유료앱 */
  --other:         #4A5468;

  --up:            #3FD68F;  --up-bg:   rgba(63,214,143,.12);
  --down:          #FF7A7A;  --down-bg: rgba(255,122,122,.12);

  --radius-card: 20px;  --radius-box: 12px;  --radius-pill: 999px;
}
```

- 글꼴: 본문 `Noto Sans KR`(400/500/700), **숫자는 `Space Grotesk`(500/600) + `font-variant-numeric: tabular-nums`**
- 카드: `background: var(--surface); border: 1px solid var(--border); box-shadow: inset 0 1px 0 rgba(255,255,255,.04)`
- 차트 격자선: `1px dashed var(--border)`, 막대 끝 둥글게 `7px 7px 3px 3px`, 세그먼트 사이 2px 간격, 선택 안 된 막대 opacity .42
- 그라데이션 배경, 이모지 아이콘 사용 금지. 아이콘은 선(stroke) SVG
- 버튼·토글 최소 높이 38~44px, 아이콘 버튼에는 `aria-label`

---

## 8. 폴더 구조

```
/
├─ CLAUDE.md
├─ firebase.json, .firebaserc, firestore.rules, firestore.indexes.json
├─ web/                    # React 앱
│  └─ src/
│     ├─ app/              # 라우팅, AuthGuard
│     ├─ features/dashboard/  (HeroCard, StackedBars, DonutMix, LiveFeed, AdSources, Stores, SyncStatus, AppTable)
│     ├─ features/auth/       (LoginPage)
│     ├─ lib/              # firebase 초기화, format(₩, %), 날짜(KST)
│     ├─ data/             # Firestore 구독 훅, 목업 데이터
│     └─ styles/tokens.css
└─ functions/
   └─ src/
      ├─ admob/  ├─ googlePlay/  ├─ appStore/  ├─ reconcile/  ├─ fx/
      └─ shared/ (money.ts, kst.ts, firestore.ts, secrets.ts)
```

---

## 9. 작업 순서 (마일스톤)

1. **UI + 목업 데이터**: `web/`에서 6·7장대로 화면 구현. `data/mock.ts`로 기간 토글·막대 호버까지 동작. Firebase 없이 `npm run dev`로 확인 가능해야 함
2. **인증**: Firebase Google 로그인 + allowlist + 보안 규칙 + AuthGuard
3. **Firestore 연결**: 목업 대신 4장 스키마를 읽도록 훅 교체 (에뮬레이터에 시드 데이터)
4. **AdMob 연동**: OAuth 연결 플로우 → `syncAdmob` → 히어로·광고 소스 카드에 실제 값
5. **Google Play 연동**: RTDN + Developer API → 피드·결제 카드
6. **App Store 연동**: ASN V2 웹훅(서명 검증) → 피드·결제 카드
7. **보정 작업**: `reconcileDaily` + 환율 + estimated/final 표시
8. **배포**: Hosting + Functions, 연동 상태 카드에 실제 `sync` 값 표시

각 단계가 끝나면 동작을 확인하고 다음으로 넘어간다. 한 번에 여러 단계를 섞지 않는다.

---

## 10. 작업 규칙 (Claude Code용)

- 코드·주석·커밋 메시지는 영어, 화면 문구는 한국어.
- 금액은 **정수 micros**로 계산·저장하고, 부동소수점 원화 계산을 하지 않는다. 표시 직전에만 `₩1,234` 형식으로 변환 (`Intl.NumberFormat('ko-KR')`).
- 날짜 경계는 항상 KST. `new Date()`를 그대로 날짜 키로 쓰지 말고 `shared/kst.ts` 유틸을 쓴다.
- 비밀값이 필요한 코드를 만들면 README에 "어느 콘솔에서 무엇을 발급해 어떤 Secret 이름으로 넣는지"를 함께 적는다.
- 외부 API 응답 형식은 추측하지 말고 공식 문서를 확인한 뒤 타입을 작성한다. 확인하지 못한 필드는 `TODO(verify)` 주석을 남긴다.
- 테스트: 금액 변환, KST 날짜 계산, 알림 중복 처리, ASN 서명 검증 실패 케이스는 단위 테스트 필수 (Vitest).
- 로컬 개발은 Firebase Emulator Suite(Auth, Firestore, Functions, Pub/Sub) 기준.

---

## 11. 아직 정하지 않은 것

- 국가별 수익, 월 목표 진행률 화면 추가 여부
- Play 재무 리포트 버킷 접근을 서비스 계정으로 할지, 사용자 OAuth로 할지
