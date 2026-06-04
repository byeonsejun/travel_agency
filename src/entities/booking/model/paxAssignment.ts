import type { PaxType } from "@prisma/client";

export interface PaxAssignmentInput {
  travelers: { key: string; birthDate: Date }[];
  adultCount: number;
  childCount: number;
  infantCount: number;
  priceAdult: number;
  priceChild: number;
  priceInfant: number;
  totalPrice: number;
}

export interface PaxAssignment {
  key: string;
  paxType: PaxType;
  unitPrice: number;
}

/**
 * 여행자를 나이 많은 순으로 정렬해 booking 카운트(adult/child/infant)에 그리디 배정.
 * unitPrice는 departure 단가 스냅샷; Σ가 totalPrice와 다르면(가격 드리프트) 차액을
 * 첫 ADULT(없으면 첫 CHILD, 없으면 첫 INFANT)에 가감해 불변식 Σ unitPrice == totalPrice를 강제.
 * 순수 함수 — 입력 배열 비변이([...].sort).
 */
export function assignPaxTypes(input: PaxAssignmentInput): PaxAssignment[] {
  const { travelers, adultCount, childCount, infantCount } = input;
  const total = adultCount + childCount + infantCount;
  if (travelers.length !== total) {
    throw new Error(
      `pax count mismatch: travelers=${travelers.length} counts=${total}`
    );
  }

  const sorted = [...travelers].sort(
    (a, b) => a.birthDate.getTime() - b.birthDate.getTime()
  );

  const buckets: { paxType: PaxType; count: number; price: number }[] = [
    { paxType: "ADULT", count: adultCount, price: input.priceAdult },
    { paxType: "CHILD", count: childCount, price: input.priceChild },
    { paxType: "INFANT", count: infantCount, price: input.priceInfant },
  ];

  const assignments: PaxAssignment[] = [];
  let idx = 0;
  for (const b of buckets) {
    for (let i = 0; i < b.count; i++) {
      assignments.push({
        key: sorted[idx].key,
        paxType: b.paxType,
        unitPrice: b.price,
      });
      idx++;
    }
  }

  // 잔차 보정: Σ unitPrice == totalPrice 강제
  const sum = assignments.reduce((s, a) => s + a.unitPrice, 0);
  const diff = input.totalPrice - sum;
  if (diff !== 0) {
    const target =
      assignments.find((a) => a.paxType === "ADULT") ??
      assignments.find((a) => a.paxType === "CHILD") ??
      assignments[0];
    if (target) {
      target.unitPrice += diff;
    }
  }

  return assignments;
}
