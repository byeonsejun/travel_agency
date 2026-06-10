"use client";
import { useState, useTransition } from "react";
import { travelerCancelAction } from "@/features/admin-traveler-cancel/server/actions";
import { Button } from "@/shared/ui/button";

interface TravelerInfo {
  id: string;
  firstNameEn: string;
  lastNameEn: string;
  paxType: string | null;
  unitPrice: number;
  canceledAt: Date | string | null;
}

interface Props {
  bookingId: string;
  travelers: TravelerInfo[];
}

export function TravelerCancelPanel({ bookingId, travelers }: Props) {
  const [sel, setSel] = useState<string[]>([]);
  const [applyPenalty, setApplyPenalty] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const active = travelers.filter((t) => !t.canceledAt);
  const canceled = travelers.filter((t) => t.canceledAt);

  function handleSubmit() {
    if (sel.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await travelerCancelAction(null, {
        bookingId,
        travelerIds: sel,
        applyPenalty,
      });
      if (result.type === "error") {
        setError(result.message);
      } else {
        setSel([]);
      }
    });
  }

  const PAX_LABEL: Record<string, string> = { ADULT: "성인", CHILD: "아동", INFANT: "유아" };

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        여행자별 부분 취소
      </h2>

      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">취소 가능한 여행자가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((t) => (
            <li key={t.id} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`t-${t.id}`}
                checked={sel.includes(t.id)}
                onChange={(e) =>
                  setSel((s) =>
                    e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)
                  )
                }
                className="h-4 w-4 rounded border-input"
              />
              <label htmlFor={`t-${t.id}`} className="text-sm text-foreground">
                {t.lastNameEn} {t.firstNameEn}{" "}
                <span className="text-xs text-muted-foreground">
                  ({t.paxType ? (PAX_LABEL[t.paxType] ?? t.paxType) : "미지정"})
                </span>{" "}
                <span className="text-xs font-medium text-muted-foreground">
                  {t.unitPrice.toLocaleString("ko-KR")}원
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {canceled.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">취소된 여행자</p>
          <ul className="space-y-1">
            {canceled.map((t) => (
              <li key={t.id} className="text-xs text-muted-foreground line-through">
                {t.lastNameEn} {t.firstNameEn} ({t.paxType ? (PAX_LABEL[t.paxType] ?? t.paxType) : "미지정"})
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={applyPenalty}
          onChange={(e) => setApplyPenalty(e.target.checked)}
          className="h-4 w-4 rounded border-input"
        />
        위약금 적용 (표준약관)
      </label>

      {error && (
        <p className="text-sm text-red-600">오류: {error}</p>
      )}

      <Button
        variant="destructive"
        disabled={isPending || sel.length === 0}
        onClick={handleSubmit}
      >
        {isPending ? "처리 중..." : `선택한 여행자 ${sel.length}명 취소`}
      </Button>
    </section>
  );
}
