"use client";

import { startTransition, useActionState, useState } from "react";
import { createCheckoutBooking } from "../server/actions";
import { TERM_KEYS } from "@/entities/booking";
import { PaymentWidget } from "./PaymentWidget";

// ── Props (RSC → client 직렬화 가능 타입만) ─────────────────────
type Props = {
  departureId: string;
  productTitle: string;
  departureDateLabel: string;
  returnDateLabel: string;
  priceAdult: number;
  priceChild: number;
  priceInfant: number;
  remainingSeats: number;
  clientKey: string;
  devFallback: boolean;
};

// ── 여행자 폼 상태 타입 (서버 Zod 검증 전 로컬 상태) ────────────
type TravelerRow = {
  lastNameEn: string;
  firstNameEn: string;
  gender: "MALE" | "FEMALE" | "";
  birthDate: string; // "YYYY-MM-DD" — Zod가 Date로 coerce
};

function makeEmptyTraveler(): TravelerRow {
  return { lastNameEn: "", firstNameEn: "", gender: "", birthDate: "" };
}

const TERM_LABELS: Record<string, string> = {
  [TERM_KEYS.STANDARD_OVERSEAS]: "해외여행 표준약관 (필수)",
  [TERM_KEYS.SPECIAL_CANCELLATION]: "특별 취소·환불 규정 (필수)",
};

// ── 컴포넌트 ────────────────────────────────────────────────────
export function CheckoutForm({
  departureId,
  productTitle,
  departureDateLabel,
  returnDateLabel,
  priceAdult,
  priceChild,
  priceInfant,
  remainingSeats,
  clientKey,
  devFallback,
}: Props) {
  const [state, dispatch, isPending] = useActionState(createCheckoutBooking, null);

  const [adultCount, setAdultCount] = useState(1);
  const [childCount, setChildCount] = useState(0);
  const [infantCount, setInfantCount] = useState(0);
  const [travelers, setTravelers] = useState<TravelerRow[]>([makeEmptyTraveler()]);
  const [checkedTerms, setCheckedTerms] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");

  // 인원 변경 시 여행자 배열 동기화
  function syncTravelers(adult: number, child: number) {
    const total = adult + child;
    setTravelers((prev) => {
      if (prev.length === total) return prev;
      if (prev.length < total) {
        return [...prev, ...Array.from({ length: total - prev.length }, makeEmptyTraveler)];
      }
      return prev.slice(0, total);
    });
  }

  function changeAdult(delta: number) {
    const next = Math.max(1, Math.min(9 - childCount, adultCount + delta));
    setAdultCount(next);
    syncTravelers(next, childCount);
  }

  function changeChild(delta: number) {
    const next = Math.max(0, Math.min(9 - adultCount, childCount + delta));
    setChildCount(next);
    syncTravelers(adultCount, next);
  }

  function changeInfant(delta: number) {
    setInfantCount((prev) => Math.max(0, Math.min(adultCount, prev + delta)));
  }

  function updateTraveler(idx: number, field: keyof TravelerRow, value: string) {
    setTravelers((prev) =>
      prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t))
    );
  }

  function toggleTerm(key: string) {
    setCheckedTerms((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(() => {
      dispatch({
        departureId,
        adultCount,
        childCount,
        infantCount,
        travelers: travelers.map((t, i) => ({
          lastNameEn: t.lastNameEn,
          firstNameEn: t.firstNameEn,
          gender: t.gender as "MALE" | "FEMALE",
          birthDate: new Date(t.birthDate),
          role: i === 0 ? ("BOOKER" as const) : ("TRAVELER" as const),
        })),
        termKeys: [...checkedTerms],
        notes: notes || undefined,
      });
    });
  }

  // 성공 → PaymentWidget으로 전환 (결제창 진입)
  if (state?.type === "success") {
    return (
      <PaymentWidget
        bookingId={state.bookingId}
        orderId={state.orderId}
        amount={state.amount}
        customerName={state.customerName}
        customerEmail={state.customerEmail}
        clientKey={clientKey}
        devFallback={devFallback}
      />
    );
  }

  const totalPrice =
    priceAdult * adultCount + priceChild * childCount + priceInfant * infantCount;
  const maxSeats = Math.min(9, remainingSeats);

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ── 여행 요약 ── */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="font-semibold text-gray-800">{productTitle}</h2>
        <p className="mt-1 text-sm text-gray-500">
          출발 {departureDateLabel} · 귀국 {returnDateLabel}
        </p>
        <p className="mt-1 text-xs text-gray-400">잔여 좌석 {remainingSeats}석</p>
      </section>

      {/* ── 인원 선택 ── */}
      <section className="space-y-3">
        <h2 className="font-semibold text-gray-800">인원 선택</h2>

        {(
          [
            { label: "성인", count: adultCount, change: changeAdult, hint: `${priceAdult.toLocaleString("ko-KR")}원` },
            { label: "아동", count: childCount, change: changeChild, hint: `${priceChild.toLocaleString("ko-KR")}원` },
            { label: "영아 (좌석 미차감)", count: infantCount, change: changeInfant, hint: `${priceInfant.toLocaleString("ko-KR")}원` },
          ] as const
        ).map(({ label, count, change, hint }) => (
          <div key={label} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <div>
              <span className="text-sm font-medium text-gray-700">{label}</span>
              <span className="ml-2 text-xs text-gray-400">{hint}</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => change(-1)}
                aria-label={`${label} 줄이기`}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                disabled={isPending}
              >
                −
              </button>
              <span className="w-4 text-center text-sm font-semibold">{count}</span>
              <button
                type="button"
                onClick={() => change(1)}
                aria-label={`${label} 늘리기`}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40"
                disabled={isPending || adultCount + childCount >= maxSeats}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </section>

      {/* ── 여행자 정보 ── */}
      <section className="space-y-4">
        <h2 className="font-semibold text-gray-800">여행자 정보</h2>
        {travelers.map((t, idx) => (
          <fieldset key={idx} className="rounded-xl border border-gray-200 bg-white p-4">
            <legend className="px-1 text-sm font-medium text-gray-700">
              {idx === 0 ? "예약자" : `여행자 ${idx + 1}`}
            </legend>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500" htmlFor={`ln-${idx}`}>
                  성 (영문 대문자)
                </label>
                <input
                  id={`ln-${idx}`}
                  type="text"
                  value={t.lastNameEn}
                  onChange={(e) => updateTraveler(idx, "lastNameEn", e.target.value.toUpperCase())}
                  placeholder="KIM"
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500" htmlFor={`fn-${idx}`}>
                  이름 (영문 대문자)
                </label>
                <input
                  id={`fn-${idx}`}
                  type="text"
                  value={t.firstNameEn}
                  onChange={(e) => updateTraveler(idx, "firstNameEn", e.target.value.toUpperCase())}
                  placeholder="CHULSOO"
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500" htmlFor={`gen-${idx}`}>
                  성별
                </label>
                <select
                  id={`gen-${idx}`}
                  value={t.gender}
                  onChange={(e) => updateTraveler(idx, "gender", e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="">선택</option>
                  <option value="MALE">남성</option>
                  <option value="FEMALE">여성</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500" htmlFor={`bd-${idx}`}>
                  생년월일
                </label>
                <input
                  id={`bd-${idx}`}
                  type="date"
                  value={t.birthDate}
                  onChange={(e) => updateTraveler(idx, "birthDate", e.target.value)}
                  required
                  max={new Date().toISOString().slice(0, 10)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>
          </fieldset>
        ))}
      </section>

      {/* ── 약관 동의 ── */}
      <section className="space-y-2">
        <h2 className="font-semibold text-gray-800">약관 동의</h2>
        {Object.entries(TERM_LABELS).map(([key, label]) => (
          <label key={key} className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <input
              type="checkbox"
              checked={checkedTerms.has(key)}
              onChange={() => toggleTerm(key)}
              className="h-4 w-4 accent-indigo-600"
            />
            <span className="text-sm text-gray-700">{label}</span>
          </label>
        ))}
      </section>

      {/* ── 메모 ── */}
      <section>
        <label className="mb-1 block text-sm font-semibold text-gray-800" htmlFor="notes">
          요청사항 <span className="font-normal text-gray-400">(선택)</span>
        </label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="특별 요청사항을 입력해 주세요"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </section>

      {/* ── 서버 에러 ── */}
      {state?.type === "error" && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.message}
        </p>
      )}

      {/* ── 가격 요약 + 제출 ── */}
      <div className="sticky bottom-4 rounded-xl border border-gray-200 bg-white p-5 shadow-md">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">결제 예정 금액</span>
          <span className="text-xl font-bold text-gray-900">
            {totalPrice.toLocaleString("ko-KR")}원
          </span>
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="mt-4 w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {isPending ? "예약 처리 중..." : "다음 — 결제 진행"}
        </button>
      </div>
    </form>
  );
}
