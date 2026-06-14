# ADR-0055: LLM-judge 반순환 라벨링 — 점수공식과 독립된 nDCG 라벨

- **상태**: Accepted
- **결정일**: 2026-06-14
- **영향 범위**: `scripts/search-eval/judge-rubric.ts`, `scripts/search-eval/judge.ts`, `scripts/search-eval/__tests__/judgeRubric.test.ts`
- **관련 commit**: `124d4e3` (45-query catalog + LLM-as-judge labels), 인접 [ADR-0050]

## Context (배경)

[ADR-0054]의 45쿼리 카탈로그는 수동 라벨이 없다. nDCG로 가중치 변별력을 보려면 쿼리×코퍼스 관련도 라벨이 필요한데, 이 라벨이 만약 임베딩 코사인 유사도(=점수공식의 핵심 입력)를 보고 매겨지면 **라벨이 점수공식을 베끼는 순환**이 된다 — 그러면 nDCG는 "공식이 자기 자신을 얼마나 잘 맞히나"를 재는 자기참조 지표로 전락해 가중치 비교가 무의미해진다.

## Decision (결정)

**judge 루브릭을 속성(attribute) 기반으로만 작성하고, 점수공식 어휘를 프롬프트·payload에서 금지한다.** judge는 상품의 태그·목적지·기간·가격 같은 *속성*만 보고 0~3 등급을 매기며, `임베딩/embedding/코사인/cosine/벡터/vector/유사도` 어휘는 금칙어로 가드 테스트가 강제한다 → 라벨이 점수공식과 구조적으로 독립 → nDCG가 비순환 측정이 된다.

```ts
// scripts/search-eval/__tests__/judgeRubric.test.ts:17-18
const forbidden = /임베딩|embedding|코사인|cosine|벡터|vector|유사도/i;
expect(JUDGE_SYSTEM_PROMPT).not.toMatch(forbidden);
// :38 — judge payload candidate 에 embedding 속성 부재 강제
expect(payload.candidates[0]).not.toHaveProperty("embedding");
```

judge↔수작업 라벨 일치도(commit `124d4e3` 본문): **within1 81.3% / exact 37.5%** (등급 척도 보수성 차이).

## Consequences (결과)

**얻은 것:**
- nDCG가 점수공식의 자기참조가 아닌, *독립 판정자* 기준의 변별력 측정이 됨 → [ADR-0054]의 가중치 sweep 비교가 의미를 가짐.
- 금칙어 가드를 단위 테스트(`judgeRubric.test.ts`)로 박제 → 프롬프트가 나중에 임베딩 어휘로 오염되면 즉시 빨강.
- judge가 DB·임베딩을 안 쓰므로(`judge.ts`, payload에 embedding 없음) 재현성·격리 확보.

**포기한 것 / 미해결:**
- exact 일치 37.5%는 낮아 보이나, within1 81.3%이고 등급 척도 보수성 차이(judge가 인접 등급으로 살짝 보수적/관대)에 기인 — 절대 라벨 정확도가 아니라 *순위 변별*용이라 허용.
- judge 모델(haiku)·루브릭(v1) 버전에 라벨이 묶임 → 모델/루브릭 교체 시 라벨 재생성 필요(fixture로 박제해 완화).

## Alternatives Considered (대안 — 가장 중요한 섹션)

### 옵션 A: 사람이 직접 전수 라벨링
- 45쿼리 × 20코퍼스 관련도를 수작업으로 매김.
- **거부.** (1) 라벨 폭증 — 45×20 조합을 사람이 일관되게 매기는 비용이 크고 확장성이 없다. (2) 카탈로그를 늘릴 때마다 재라벨링 워크플로가 따라붙어 측정 하네스의 "재현 가능·저비용" 목표와 충돌. golden 10건 수작업 라벨은 이미 존재하나(일치도 기준선), 카탈로그 규모에선 비현실적.

### 옵션 B: judge에게 임베딩/유사도 점수를 함께 제공
- candidate에 코사인 유사도를 동봉해 judge가 참고하게 함(라벨 품질 향상 기대).
- **거부.** 이게 정확히 순환을 만든다 — 라벨이 점수공식의 출력을 복사하면 nDCG는 "공식 vs 공식"을 재는 자기참조가 되어 가중치 비교가 무의미해진다. 그래서 임베딩 어휘 자체를 금칙어로 막고(`judge-rubric.ts:8`), payload에서 embedding 속성을 제거(`judgeRubric.test.ts:38`).

## Notes

- judge 루브릭/프롬프트 수정 시 `judgeRubric.test.ts`의 금칙어 정규식이 통과하는지 반드시 확인 — 이 가드가 반순환성의 마지막 방어선.
- 라벨은 `judge-labels.fixture.json`(model=haiku, rubric=v1)로 박제됨. 모델/루브릭 bump 시 fixture 재생성 + 일치도 재측정.
