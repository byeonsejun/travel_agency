# Nextour 문서 목차

이 디렉토리는 Nextour 프로젝트의 모든 공식 문서를 관리합니다.

## 문서 구조

```
docs/
├── product/       ← 기획·제품 문서 (PM, 디자이너 대상)
└── technical/     ← 기술 문서 (개발자 대상)
```

## 제품 문서 (product/)

| 문서 | 설명 | 대상 |
|------|------|------|
| [PRD.md](./product/PRD.md) | 제품 요구사항 정의서 — 기능 명세, 비즈니스 정책, 기술 스택 | 전체 팀 |
| [original-plan.md](./product/original-plan.md) | 최초 기획서 원본 — 유저 시나리오, 화면 요구사항 초안 | 참고용 |

## 기술 문서 (technical/)

| 문서 | 설명 | 대상 |
|------|------|------|
| [ARCHITECTURE.md](./technical/ARCHITECTURE.md) | 시스템 아키텍처 — 도메인 모델, 상태머신, 결제 흐름, FSD 폴더 구조 | 개발자 |

## 문서 작성 규칙

- 제품 결정사항은 `product/PRD.md`에 반영
- 기술 결정사항은 `technical/ARCHITECTURE.md`에 반영
- 새 문서 추가 시 이 README에도 항목 추가
