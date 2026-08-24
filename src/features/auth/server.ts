// auth 슬라이스의 **server-only 공개 API**.
//
// `index.ts`(기본 배럴)는 `./ui/*`('use client' 아일랜드 5종 — OAuthLoginButtons·
// LogoutButton·UserNavIsland·SessionPoll·AuthSuccessClient)를 함께 re-export 하므로,
// RSC page·route handler·Server Action 이 `auth()` 하나 때문에 그걸 import 하면
// 쓰지도 않는 client 그래프가 서버 모듈에 딸려온다.
//
// `entities/booking/client.ts`(client 가 server 를 끌어오지 않게 하는 엔트리)와
// 정확히 대칭인 반대 방향 엔트리다. UI 컴포넌트가 필요한 모듈은 계속
// `@/features/auth` 를 쓴다.
//
// 여기서 re-export 하는 것은 모두 server 전용(NextAuth 인스턴스)이어야 한다.

export { auth, handlers, signIn, signOut } from "./server/auth";
