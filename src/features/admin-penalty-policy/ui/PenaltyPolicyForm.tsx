"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { savePenaltyPolicyAction } from "../server/actions";
import type { SavePenaltyPolicyInput } from "../model/schemas";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";

// 표준약관 기본 템플릿(편집 출발점). 클라이언트 번들 격리를 위해 리터럴 인라인
// (entity barrel 의 OVERSEAS_PENALTY_TIERS 를 import 하면 server-only 체인이 따라옴).
// 마지막 행은 catch-all(minDaysBefore = CATCH_ALL).
const CATCH_ALL = -99999;
const DEFAULT_ROWS: TierRow[] = [
  { minDaysBefore: "30", ratePercent: "0" },
  { minDaysBefore: "20", ratePercent: "10" },
  { minDaysBefore: "10", ratePercent: "15" },
  { minDaysBefore: "8", ratePercent: "20" },
  { minDaysBefore: "1", ratePercent: "30" },
  { minDaysBefore: String(CATCH_ALL), ratePercent: "50" },
];

type TierRow = { minDaysBefore: string; ratePercent: string };

export function PenaltyPolicyForm() {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [rows, setRows] = useState<TierRow[]>(DEFAULT_ROWS);
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, dispatch, isPending] = useActionState(
    savePenaltyPolicyAction,
    null,
  );

  // 성공 → 폼 초기화 + RSC 목록 재렌더
  useEffect(() => {
    if (state?.type === "success") {
      setKey("");
      setName("");
      setRows(DEFAULT_ROWS);
      setClientError(null);
      router.refresh();
    }
  }, [state, router]);

  function updateRow(i: number, patch: Partial<TierRow>) {
    setRows((cur) => cur.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((cur) => [...cur, { minDaysBefore: "0", ratePercent: "0" }]);
  }
  function removeRow(i: number) {
    setRows((cur) => (cur.length > 1 ? cur.filter((_, idx) => idx !== i) : cur));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isPending) return;
    setClientError(null);

    // 클라이언트 보조 검증(UX) — 보안 경계는 서버 액션의 Zod (R8)
    const tiers: SavePenaltyPolicyInput["tiers"] = [];
    for (const r of rows) {
      const minDaysBefore = Number(r.minDaysBefore);
      const ratePercent = Number(r.ratePercent);
      if (!Number.isInteger(minDaysBefore)) {
        setClientError("출발 N일 전(minDaysBefore)은 정수로 입력해 주세요");
        return;
      }
      if (Number.isNaN(ratePercent) || ratePercent < 0 || ratePercent > 100) {
        setClientError("위약금률(%)은 0~100 사이로 입력해 주세요");
        return;
      }
      tiers.push({ minDaysBefore, rate: ratePercent / 100 });
    }

    const input: SavePenaltyPolicyInput = { key: key.trim(), name: name.trim(), tiers };
    startTransition(() => dispatch(input));
  }

  const errorMessage =
    clientError ?? (state?.type === "error" ? state.message : null);

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-2xl border border-border bg-card p-6"
    >
      <div>
        <h2 className="text-lg font-bold text-foreground">새 정책 버전 생성</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          기존 key 로 저장하면 새 버전이 추가되고 이전 버전은 자동 비활성화됩니다
          (append-only). 예약은 생성 시점 버전으로 동결되어 소급되지 않습니다.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="policy-key"
            className="block text-sm font-medium text-foreground"
          >
            정책 key (소문자/숫자/_) — 버전 간 안정 식별자
          </label>
          <Input
            id="policy-key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={isPending}
            placeholder="예: peak_season"
            className="mt-1 font-mono"
          />
        </div>
        <div>
          <label
            htmlFor="policy-name"
            className="block text-sm font-medium text-foreground"
          >
            정책 이름
          </label>
          <Input
            id="policy-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            placeholder="예: 성수기 위약 정책"
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">
            위약금 구간 (minDaysBefore 내림차순 · 마지막 행 = catch-all)
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addRow}
            disabled={isPending}
          >
            + 구간 추가
          </Button>
        </div>
        <div className="mt-2 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <label className="sr-only" htmlFor={`min-${i}`}>
                출발 N일 전
              </label>
              <Input
                id={`min-${i}`}
                type="number"
                value={r.minDaysBefore}
                onChange={(e) => updateRow(i, { minDaysBefore: e.target.value })}
                disabled={isPending}
                className="w-32"
              />
              <span className="text-sm text-muted-foreground">일 전부터</span>
              <label className="sr-only" htmlFor={`rate-${i}`}>
                위약금률 퍼센트
              </label>
              <Input
                id={`rate-${i}`}
                type="number"
                value={r.ratePercent}
                onChange={(e) => updateRow(i, { ratePercent: e.target.value })}
                disabled={isPending}
                min={0}
                max={100}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">% 공제</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${i + 1}번째 구간 삭제`}
                onClick={() => removeRow(i)}
                disabled={isPending || rows.length <= 1}
                className="ml-auto text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                삭제
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          catch-all 행은 minDaysBefore 를 매우 작은 값(예: {CATCH_ALL})으로 두어 모든 잔여
          구간을 포괄합니다.
        </p>
      </div>

      {errorMessage && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      )}
      {state?.type === "success" && (
        <p
          role="status"
          className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700"
        >
          저장 완료 — {state.key} v{state.version} 가 활성화되었습니다.
        </p>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={isPending || key.trim().length === 0 || name.trim().length === 0}
        >
          {isPending ? "저장 중..." : "정책 버전 저장"}
        </Button>
      </div>
    </form>
  );
}
