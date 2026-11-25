# ADR-0064: 검색에는 공개 화면 4곳만 내보내고 비공개 화면은 noindex 로 막는다 — robots.txt 는 `/api/` 만, 상품 상세는 Product + AggregateOffer 구조화 데이터

- **상태**: Accepted
- **결정일**: 2026-11-25
- **영향 범위**: `src/shared/lib/seo/*`, `src/shared/ui/JsonLd.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/llms.txt/route.ts`, `src/widgets/product-detail/model/productSeo.ts`, `src/entities/product`(`getPublishedProductIndex`), `src/app/(site)/{bookings,login,mypage,reviews,products/[id]/checkout}/layout.tsx`, `src/app/(admin)/admin/layout.tsx` (결제 · 예약 도메인과 기존 `page.tsx` 는 무변경)
- **관련 commit**: `4986bf0`, `5b509cf`, `96559d6`, `6699201`

## Context (배경)

검색 노출에 필요한 것이 거의 없는 상태였다. 운영 사이트의 `/robots.txt`, `/sitemap.xml`, `/llms.txt` 는 모두 404 였고, 메타데이터는 루트 `layout.tsx` 의 제목 · 설명 하나뿐이라 모든 상품 상세가 같은 제목(`Nextour — AI 패키지 여행 예약`)으로 나갔다. canonical 도 공유 카드(Open Graph)도 구조화 데이터도 없었다.

반대로 이 사이트에는 검색에 나가면 안 되는 화면이 많다. 로그인, 마이페이지, 예약 내역, 결제, 후기 작성, 관리자 화면이다. 색인을 열어 주는 작업이므로 무엇을 열고 무엇을 닫을지를 같이 정해 두지 않으면, 사이트맵을 만드는 순간 비공개 화면의 주소까지 같이 나갈 위험이 있다.

그리고 점수를 올리려는 작업이 아니다. 작업 전 운영 Lighthouse(13.4.1, 모바일) SEO 점수는 `/` 100, 상품 상세 `/products/cmq7cjspo0000q3ixvx26oesg` 100 이었다(2026-11-25 측정). Lighthouse 가 보는 것은 title · description · 크롤 가능 여부 같은 기본 위생이라 이미 통과하고 있었다. 모자란 것은 그 바깥, 즉 검색 결과에 상품 이름과 가격이 제대로 붙는지, 비공개 화면이 새지 않는지였다.

## Decision (결정)

**색인할 곳은 공개 화면 4곳으로 한정하고, 비공개 화면은 robots.txt 가 아니라 페이지 메타데이터의 `noindex` 로 막는다.**

색인 대상
- `/`, `/products`, `/products/[id]`, `/search`. 사이트맵과 `llms.txt` 는 같은 함수(`getPublishedProductIndex`, `PUBLISHED` 상품만)로 상품 목록을 만들어 서로 어긋나지 않게 한다.
- 각 페이지는 고유한 제목 · 설명 · canonical · 공유 카드를 가진다. 상품 상세는 `aiSummary` 가 있으면 그것을, 없으면 `지역 · N박 M일 · 성인 기준 X원~` 를 설명으로 쓴다.

noindex 대상
- `/login/**`, `/mypage`, `/bookings/**`, `/products/[id]/checkout`, `/reviews/**`, `/admin/**`: 색인도 링크 따라가기도 막는다(`index: false, follow: false`).
- `/compare`: 색인은 막고 링크는 따라가게 둔다(`index: false, follow: true`). 사이트맵에도 넣지 않는다.
- 위 비공개 화면의 noindex 는 기존 `page.tsx` 가 아니라, 메타데이터만 내보내는 `layout.tsx` 로 단다. 로그인 · 예약 · 결제 · 마이페이지 · 후기는 새 layout 파일 다섯 개를 만들었고, 관리자는 이미 있던 layout 에 `metadata` export 3줄만 더했다.

그 밖의 규칙
- `robots.txt` 는 운영에서 `/api/` 만 막고 사이트맵 주소를 알린다. 비공개 화면은 여기서 막지 않는다. AI 검색 로봇도 따로 막지 않는다.
- 미리보기 배포(`VERCEL_ENV === "preview"`)는 `robots.txt` 로 전체 차단하고 루트 메타데이터에도 `noindex` 를 건다. 로컬과 운영은 색인을 허용한다.
- canonical 의 기준 주소는 상수 `SITE_URL` 이다. 미리보기에서 열어도 canonical 은 운영 주소를 가리킨다.
- 상품 상세 구조화 데이터는 화면에 보이는 값만 쓴다. `Product`(이름 · 설명 · 대표 사진 · `AggregateOffer`)와 `BreadcrumbList`. 가격은 출발일 성인가의 최저 · 최고, 통화는 `KRW`, 출발일 수는 `offerCount`. 판매종료 상품이거나 출발일이 없으면 `offers` 를 넣지 않고, 출발일이 모두 마감이면 `availability` 는 `SoldOut`. 홈에는 `WebSite`(`name`, `url`, `inLanguage`)만 넣는다.
- JSON-LD 는 서버 컴포넌트가 HTML 에 직접 넣는다(`JsonLd`, `<` 를 이스케이프해 상품 이름에 `</script>` 가 들어가도 스크립트가 깨지지 않게 한다). 새 클라이언트 JS 는 없다.

```ts
// src/shared/lib/seo/metadata.ts
export const NOINDEX_METADATA: Metadata = { robots: { index: false, follow: false } };

// src/app/(site)/mypage/layout.tsx — page.tsx 는 건드리지 않는다
export const metadata = NOINDEX_METADATA;
```

## Consequences (결과)

**얻은 것:**
- 상품마다 고유한 제목 · 설명 · canonical 이 나가고, 사이트맵과 `llms.txt` 가 같은 목록에서 만들어져 상품이 추가 · 판매종료돼도 따로 손볼 곳이 없다.
- 비공개 화면은 크롤러가 페이지를 열어 `noindex` 를 직접 읽게 되므로, 주소만 색인에 남는 경우가 없다.
- 결제 · 예약 도메인 코드와 기존 `page.tsx` 를 한 줄도 수정하지 않았다. 새 layout 파일 다섯 개를 추가하고, 기존 관리자 layout 에는 `metadata` export 만 더했다.
- 가격과 재고 표시가 화면의 "성인 기준 ~원부터" 와 같은 필드에서 나와, 구조화 데이터와 화면이 서로 다른 말을 하지 않는다.
- 빌드 결과도 그대로다. 홈은 `○`, `/products/[id]` 는 `◐`(PPR)를 유지하고, `/robots.txt` · `/sitemap.xml` · `/llms.txt` 는 정적(`○`)으로 만들어진다.

**포기한 것 / 미해결:**
- **운영 Lighthouse SEO 는 이 작업 전에도 100이었다.** 그래서 점수가 오르는 효과는 없고 기대하지도 않는다. 이 작업의 효과는 점수가 아니라 검색 결과에 보이는 내용(제목 · 설명 · 가격 범위)과 비공개 화면 차단이다.
- 구글 리치 결과 테스트로 구조화 데이터가 실제로 인식되는지는 확인하지 않았다(자동화할 수 없는 도구다). 출력 JSON 은 단위 테스트로만 검증했고, 검색 결과에 가격이 나오는지는 배포 후 Search Console 에서 봐야 안다.
- 개별 출발일의 재고와 가격은 구조화 데이터에 내보내지 않는다. 대신 최저 · 최고가와 출발일 수만 알린다.
- 상품 상세는 PPR 이라 HTML 에 들어가는 구조화 데이터가 캐시 주기(`use cache`, 최대 약 1시간)만큼 지연될 수 있다.
- 미리보기 배포는 `robots.txt` 가 전체를 막기 때문에 거기 달린 `noindex` 는 크롤러가 읽지 못한다. 미리보기 주소는 어디에도 링크되지 않으므로 받아들였다. 비공개 화면에 robots 차단을 쓰지 않는 이유(아래 A)와 같은 한계지만, 이 경우는 주소 노출 자체가 거의 없어서 문제가 되지 않는다.

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 비공개 화면을 `robots.txt` 의 Disallow 로 막기
- `Disallow: /mypage`, `/bookings` 같은 줄을 추가.
- 거부: 로봇이 페이지를 열 수 없으면 그 페이지의 `noindex` 도 읽을 수 없다. 다른 곳에서 주소로 링크가 걸리면 본문 없이 주소만 색인에 남을 수 있다. 막으려는 의도와 반대로 동작할 수 있어 `noindex` 만 쓰고 robots 는 `/api/` 만 막는다.

### 옵션 B: canonical 기준 주소를 `env.NEXT_PUBLIC_APP_URL` 로
- 환경변수 하나로 canonical 과 사이트맵 주소를 만든다.
- 거부: 미리보기와 로컬에서 그 배포의 주소가 canonical 로 박혀, 검색엔진에게 미리보기가 정본이라고 알리는 셈이 된다. 정본은 운영 하나이므로 상수 `SITE_URL` 로 고정하고, 미리보기 여부만 `VERCEL_ENV` 로 판정한다.

### 옵션 C: 출발일마다 `Offer` 를 따로 내보내기
- 출발일 하나당 `Offer` 하나(가격 · 재고 포함).
- 거부: 좌석 수는 화면에서 20초 간격으로 폴링해 바뀌는 값인데, HTML 에 박힌 개별 재고는 캐시된 채로 금방 틀린다. 화면의 "성인 기준 ~원부터" 와 맞는 표현은 최저 · 최고가이므로 `AggregateOffer`(`lowPrice` · `highPrice` · `offerCount`)를 쓴다.

### 옵션 D: 홈에 `WebSite` + `SearchAction`(사이트 링크 검색창)
- 검색 결과에서 사이트 안 검색을 바로 하게 하는 마크업.
- 거부: 구글이 2024-11 에 이 검색창 표시를 종료했다. 효과 없이 마크업만 늘어난다. FAQ 구조화 데이터를 뺀 것과 같은 이유다. 검색 결과의 사이트 이름에 쓰이는 `WebSite` 의 `name` · `url` · `inLanguage` 만 남겼다.

### 옵션 E: `/compare` 도 색인하기
- 공개 화면이니 색인 대상에 포함.
- 거부: 내용이 담아 둔 상품 id(`?compareIds=`)에 달려 있고, 없으면 "비교할 상품이 없습니다" 뿐인 빈 화면이다. 검색으로 들어온 사람이 빈 화면을 보게 된다. 색인은 막되 화면 안의 링크는 따라가도록 `follow: true` 로 두고, 사이트맵에서도 뺐다.

### 옵션 F: 비공개 화면의 noindex 를 기존 `page.tsx` 에서 export
- 각 페이지 파일에 `export const metadata` 를 추가.
- 거부: 결제 · 예약 · 마이페이지 `page.tsx` 를 수정하게 된다. 이 영역은 돈과 좌석이 걸려 있어 검색 노출 같은 부수 작업으로 diff 를 만들고 싶지 않았다. 폴더에 메타데이터만 내보내는 `layout.tsx` 를 새로 두면(관리자는 기존 layout 에 export 만 추가) 결제 · 예약 `page.tsx` 는 그대로고, 하위 경로 전체에 적용된다.

### 옵션 G: 미들웨어에서 `X-Robots-Tag` 헤더로 차단
- `src/middleware.ts` 에서 비공개 경로 응답에 헤더를 붙인다.
- 거부: 미들웨어에는 인증 리다이렉트가 있어 보안 · 인증 코드를 수정해야 한다. 경로 목록이 미들웨어와 화면 두 곳에 갈라지는 점도 걸렸다. 화면 옆 layout 에 두면 어떤 화면이 막혀 있는지 폴더에서 바로 보인다.

### 옵션 H: 정적 `public/llms.txt`
- 파일을 손으로 써서 둔다.
- 거부: 상품 목록이 사이트맵과 어긋난다. 상품이 추가되거나 판매종료될 때마다 사람이 고쳐야 하고, 잊으면 존재하지 않는 상품을 AI 에게 안내하게 된다. 사이트맵과 같은 함수에서 만드는 라우트(`src/app/llms.txt/route.ts`)로 했다.

## Notes

- **없는 상품 주소의 상태 코드.** 존재하지 않는 상품 id 로 들어가면 화면은 not-found 본문이고 메타데이터에는 `noindex` 가 붙지만, HTTP 상태는 404 가 아니라 200 으로 나간다. PPR 에서 정적 셸이 먼저 스트리밍돼 상태 코드가 이미 정해진 뒤에 not-found 가 판정되기 때문이다(소프트 404). 이 작업 이전의 운영에서도 똑같았고, 이 작업의 범위가 아니라 고치지 않았다. 사이트맵에는 `PUBLISHED` 상품만 들어가므로 검색엔진이 없는 상품 주소를 먼저 발견할 일은 드물다.
- **비공개 화면을 새로 만들 때.** 새 로그인 · 결제 · 관리자 성격의 경로를 추가하면 그 폴더에 `NOINDEX_METADATA` 를 내보내는 `layout.tsx` 를 같이 둬야 한다. 목록을 한곳에서 관리하지 않으므로 빠뜨려도 빌드가 알려 주지 않는다.
- `@/shared/lib/seo` 는 `env` 를 import 하므로 서버 전용이다. `'use client'` 파일에서 import 하면 안 된다(`CLAUDE.md` §8 의 `photoMime.ts` 사고와 같은 이유). `JsonLd` 는 `env` 를 import 하지 않는다.
- 배포 후 할 일: Search Console 에 사이트맵을 제출하고, 상품 상세 URL 검사에서 구조화 데이터가 읽히는지 본다. 가격이 검색 결과에 나오는지는 색인이 된 뒤에야 알 수 있다.
