"use client";

import { startTransition, useActionState, useState } from "react";
import type { AdminDepartureRow } from "@/entities/departure";
import type { DepartureActionState } from "../server/actions";
import type { DepartureFormInput } from "../model/schemas";

type Props = {
  action: (
    prev: DepartureActionState | null,
    input: DepartureFormInput,
  ) => Promise<DepartureActionState>;
  // edit 모드에서 가격 경고 배너 노출용. create 모드는 0.
  bookedSeats?: number;
  initial?: AdminDepartureRow | null;
};

function toDateInput(d: Date | string | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10); // yyyy-mm-dd
}

export function DepartureForm({ action, bookedSeats = 0, initial = null }: Props) {
  const [state, formAction, isPending] = useActionState(action, null);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 1);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input: DepartureFormInput = {
      departureDate: new Date(String(fd.get("departureDate"))),
      returnDate: new Date(String(fd.get("returnDate"))),
      priceAdult: Number(fd.get("priceAdult")),
      priceChild: Number(fd.get("priceChild")),
      priceInfant: Number(fd.get("priceInfant")),
      capacity: Number(fd.get("capacity")),
      minPax: Number(fd.get("minPax")),
    };
    startTransition(() => formAction(input));
  }

  const fieldErr = (k: string) =>
    state?.type === "error" ? state.fieldErrors?.[k]?.[0] : undefined;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* 가격 경고 배너 (D2) — 차단 아님, 정보성 */}
      {bookedSeats > 0 && (
        <div className="rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          이미 {bookedSeats}건의 예약이 있습니다. 가격을 수정해도 기존 예약은 결제
          시점에 잠긴 금액을 유지하며, 신규 예약부터 새 가격이 적용됩니다.
        </div>
      )}

      {/* 차단 에러 */}
      {state?.type === "error" && !state.fieldErrors && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {state.message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Field label="출발일" name="departureDate" type="date"
          defaultValue={toDateInput(initial?.departureDate)} error={fieldErr("departureDate")} />
        <Field label="귀국일" name="returnDate" type="date"
          defaultValue={toDateInput(initial?.returnDate)} error={fieldErr("returnDate")} />
        <Field label="성인 요금(원)" name="priceAdult" type="number"
          defaultValue={initial?.priceAdult ?? 0} error={fieldErr("priceAdult")} />
        <Field label="아동 요금(원)" name="priceChild" type="number"
          defaultValue={initial?.priceChild ?? 0} error={fieldErr("priceChild")} />
        <Field label="유아 요금(원)" name="priceInfant" type="number"
          defaultValue={initial?.priceInfant ?? 0} error={fieldErr("priceInfant")} />
        <Field label="정원" name="capacity" type="number" min={1}
          defaultValue={initial?.capacity ?? 1} error={fieldErr("capacity")}
          onChange={(v) => setCapacity(Number(v))} />
        <Field label="최소 출발 인원" name="minPax" type="number" min={1}
          defaultValue={initial?.minPax ?? 1} error={fieldErr("minPax")} />
      </div>

      {initial && capacity < initial.bookedSeats && (
        <p className="text-sm text-red-600">
          현재 예약 {initial.bookedSeats}석 — 정원을 그 이하로 저장하면 거부됩니다.
        </p>
      )}

      <button type="submit" disabled={isPending}
        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
        {isPending ? "저장 중…" : initial ? "수정 저장" : "출발일 생성"}
      </button>
    </form>
  );
}

function Field({
  label, name, type, defaultValue, error, min, onChange,
}: {
  label: string; name: string; type: string;
  defaultValue: string | number; error?: string; min?: number;
  onChange?: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700">{label}</span>
      <input
        name={name} type={type} defaultValue={defaultValue} min={min} required
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        className="block w-full rounded-lg border border-gray-300 px-3 py-2"
      />
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}
