# Nextour (넥스투어)

> AI가 찾아주는 맞춤형 패키지 여행 예약 플랫폼

자연어 검색으로 조건에 맞는 패키지 여행을 탐색하고, 여행사 도메인 규칙(최소 출발 인원·동적 가격·실시간 좌석 차감)이 그대로 반영된 예약 플로우를 제공합니다.

## 기술 스택

| 분류 | 기술 |
|------|------|
| Frontend / Backend | Next.js 15 (App Router) + TypeScript |
| Database | PostgreSQL (Supabase) + Prisma ORM |
| AI | Anthropic Claude API + pgvector |
| 인증 | Auth.js v5 (이메일 매직링크 + 카카오) |
| 결제 | 토스페이먼츠 |
| 배포 | Vercel |

## 빠른 시작

```bash
# 의존성 설치
npm install

# 환경변수 설정
cp .env.example .env.local
# .env.local 편집 후 필수 키 입력

# DB 마이그레이션 + 시드
npm run db:migrate
npm run db:seed

# 개발 서버 실행
npm run dev
```

## 필수 환경변수

| 변수 | 설명 |
|------|------|
| `DATABASE_URL` | Supabase PostgreSQL 연결 URL |
| `AUTH_SECRET` | Auth.js 시크릿 (`openssl rand -base64 32`) |
| `RESEND_API_KEY` | 이메일 발송용 Resend API 키 |
| `RESEND_FROM_EMAIL` | 발신자 이메일 주소 |

전체 환경변수 목록은 [`.env.example`](./.env.example) 참고.

## 문서

- [제품 요구사항 (PRD)](./docs/product/PRD.md)
- [시스템 아키텍처](./docs/technical/ARCHITECTURE.md)
- [문서 목차](./docs/README.md)

## 주요 npm 스크립트

| 명령어 | 설명 |
|--------|------|
| `npm run dev` | 개발 서버 실행 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | TypeScript 타입 검사 |
| `npm run test` | Vitest 테스트 실행 |
| `npm run db:migrate` | Prisma 마이그레이션 |
| `npm run db:studio` | Prisma Studio (DB GUI) |
| `npm run db:seed` | 시드 데이터 삽입 |
