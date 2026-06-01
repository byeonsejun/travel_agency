"use client";

import type { z } from "zod";
import type { itineraryDaySchema } from "@/entities/product";

// ── 타입 ────────────────────────────────────────────────────────────
export type ItineraryDayInput = z.infer<typeof itineraryDaySchema>;
type ItineraryStopInput = ItineraryDayInput["stops"][number];

type Props = {
  days: ItineraryDayInput[];
  onChange: (days: ItineraryDayInput[]) => void;
  fieldErrors?: Record<string, string[]>;
};

// ── 팩토리 ──────────────────────────────────────────────────────────
function emptyStop(order: number): ItineraryStopInput {
  return { order, time: "", place: "", description: "" };
}

function emptyDay(dayNumber: number): ItineraryDayInput {
  return {
    dayNumber,
    title: "",
    accommodation: "",
    meals: { breakfast: "", lunch: "", dinner: "" },
    stops: [emptyStop(1)],
  };
}

// ── 컴포넌트 ────────────────────────────────────────────────────────
export function ItineraryEditor({ days, onChange, fieldErrors }: Props) {
  // 상위에서 controlled로 동작 — 로컬 state 없음

  // Day CRUD
  function addDay() {
    const nextNumber = days.length > 0 ? Math.max(...days.map((d) => d.dayNumber)) + 1 : 1;
    onChange([...days, emptyDay(nextNumber)]);
  }

  function removeDay(idx: number) {
    const next = days.filter((_, i) => i !== idx);
    // dayNumber 재정렬 (연속성 유지)
    onChange(next.map((d, i) => ({ ...d, dayNumber: i + 1 })));
  }

  function moveDayUp(idx: number) {
    if (idx === 0) return;
    const next = [...days];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    // dayNumber 재정렬
    onChange(next.map((d, i) => ({ ...d, dayNumber: i + 1 })));
  }

  function moveDayDown(idx: number) {
    if (idx === days.length - 1) return;
    const next = [...days];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    // dayNumber 재정렬
    onChange(next.map((d, i) => ({ ...d, dayNumber: i + 1 })));
  }

  function updateDay(idx: number, patch: Partial<Omit<ItineraryDayInput, "stops">>) {
    onChange(days.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function updateMeal(
    dayIdx: number,
    key: "breakfast" | "lunch" | "dinner",
    value: string,
  ) {
    onChange(
      days.map((d, i) =>
        i === dayIdx ? { ...d, meals: { ...d.meals, [key]: value } } : d,
      ),
    );
  }

  // Stop CRUD
  function addStop(dayIdx: number) {
    const day = days[dayIdx];
    const nextOrder = day.stops.length > 0 ? Math.max(...day.stops.map((s) => s.order)) + 1 : 1;
    const newStop = emptyStop(nextOrder);
    onChange(days.map((d, i) => (i === dayIdx ? { ...d, stops: [...d.stops, newStop] } : d)));
  }

  function removeStop(dayIdx: number, stopIdx: number) {
    const next = days[dayIdx].stops.filter((_, i) => i !== stopIdx);
    // order 재정렬
    const reordered = next.map((s, i) => ({ ...s, order: i + 1 }));
    onChange(days.map((d, i) => (i === dayIdx ? { ...d, stops: reordered } : d)));
  }

  function moveStopUp(dayIdx: number, stopIdx: number) {
    if (stopIdx === 0) return;
    const stops = [...days[dayIdx].stops];
    [stops[stopIdx - 1], stops[stopIdx]] = [stops[stopIdx], stops[stopIdx - 1]];
    const reordered = stops.map((s, i) => ({ ...s, order: i + 1 }));
    onChange(days.map((d, i) => (i === dayIdx ? { ...d, stops: reordered } : d)));
  }

  function moveStopDown(dayIdx: number, stopIdx: number) {
    const stops = days[dayIdx].stops;
    if (stopIdx === stops.length - 1) return;
    const next = [...stops];
    [next[stopIdx], next[stopIdx + 1]] = [next[stopIdx + 1], next[stopIdx]];
    const reordered = next.map((s, i) => ({ ...s, order: i + 1 }));
    onChange(days.map((d, i) => (i === dayIdx ? { ...d, stops: reordered } : d)));
  }

  function updateStop(dayIdx: number, stopIdx: number, patch: Partial<ItineraryStopInput>) {
    onChange(
      days.map((d, i) =>
        i === dayIdx
          ? {
              ...d,
              stops: d.stops.map((s, j) => (j === stopIdx ? { ...s, ...patch } : s)),
            }
          : d,
      ),
    );
  }

  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
  const labelCls = "mb-1 block text-xs font-medium text-gray-500";
  const btnSm =
    "rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40";

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">일정 (Itinerary)</h3>
        <button type="button" onClick={addDay} className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100">
          + Day 추가
        </button>
      </div>

      {/* itinerary 레벨 에러 */}
      {fieldErrors?.itineraryDays && (
        <p className="text-sm text-red-600">{fieldErrors.itineraryDays[0]}</p>
      )}

      {days.length === 0 && (
        <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
          Day를 추가하세요
        </p>
      )}

      {days.map((day, dayIdx) => (
        <div key={dayIdx} className="rounded-xl border border-gray-200 bg-white p-4">
          {/* Day 헤더 */}
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Day {day.dayNumber}</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => moveDayUp(dayIdx)}
                disabled={dayIdx === 0}
                className={btnSm}
                aria-label="Day 위로"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => moveDayDown(dayIdx)}
                disabled={dayIdx === days.length - 1}
                className={btnSm}
                aria-label="Day 아래로"
              >
                ▼
              </button>
              <button
                type="button"
                onClick={() => removeDay(dayIdx)}
                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                aria-label="Day 삭제"
              >
                삭제
              </button>
            </div>
          </div>

          {/* Day 기본 필드 */}
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelCls} htmlFor={`day-title-${dayIdx}`}>
                일정 제목 *
              </label>
              <input
                id={`day-title-${dayIdx}`}
                type="text"
                value={day.title}
                onChange={(e) => updateDay(dayIdx, { title: e.target.value })}
                placeholder="예: 인천 출발 → 도쿄 나리타 도착"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor={`day-hotel-${dayIdx}`}>
                숙박
              </label>
              <input
                id={`day-hotel-${dayIdx}`}
                type="text"
                value={day.accommodation ?? ""}
                onChange={(e) => updateDay(dayIdx, { accommodation: e.target.value })}
                placeholder="호텔명"
                className={inputCls}
              />
            </div>
            {/* 식사 */}
            <div>
              <p className={labelCls}>식사</p>
              <div className="flex gap-2">
                {(
                  [
                    { key: "breakfast", placeholder: "아침" },
                    { key: "lunch", placeholder: "점심" },
                    { key: "dinner", placeholder: "저녁" },
                  ] as const
                ).map(({ key, placeholder }) => (
                  <input
                    key={key}
                    type="text"
                    value={day.meals[key] ?? ""}
                    onChange={(e) => updateMeal(dayIdx, key, e.target.value)}
                    placeholder={placeholder}
                    aria-label={`${placeholder} (Day ${day.dayNumber})`}
                    className="w-full rounded-lg border border-gray-300 px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Stops */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-gray-600">방문지 (Stops)</p>
              <button
                type="button"
                onClick={() => addStop(dayIdx)}
                className="rounded bg-gray-50 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
              >
                + Stop 추가
              </button>
            </div>

            {day.stops.length === 0 && (
              <p className="text-xs text-gray-400">Stop이 없습니다.</p>
            )}

            {day.stops.map((stop, stopIdx) => (
              <div key={stopIdx} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-500">
                    Stop {stop.order}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveStopUp(dayIdx, stopIdx)}
                      disabled={stopIdx === 0}
                      className={btnSm}
                      aria-label="Stop 위로"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStopDown(dayIdx, stopIdx)}
                      disabled={stopIdx === day.stops.length - 1}
                      className={btnSm}
                      aria-label="Stop 아래로"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      onClick={() => removeStop(dayIdx, stopIdx)}
                      className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 hover:bg-red-100"
                      aria-label="Stop 삭제"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls} htmlFor={`stop-place-${dayIdx}-${stopIdx}`}>
                      장소 *
                    </label>
                    <input
                      id={`stop-place-${dayIdx}-${stopIdx}`}
                      type="text"
                      value={stop.place}
                      onChange={(e) => updateStop(dayIdx, stopIdx, { place: e.target.value })}
                      placeholder="예: 센소지"
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor={`stop-time-${dayIdx}-${stopIdx}`}>
                      시간
                    </label>
                    <input
                      id={`stop-time-${dayIdx}-${stopIdx}`}
                      type="text"
                      value={stop.time ?? ""}
                      onChange={(e) => updateStop(dayIdx, stopIdx, { time: e.target.value })}
                      placeholder="09:00"
                      className={inputCls}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className={labelCls} htmlFor={`stop-desc-${dayIdx}-${stopIdx}`}>
                      설명
                    </label>
                    <input
                      id={`stop-desc-${dayIdx}-${stopIdx}`}
                      type="text"
                      value={stop.description ?? ""}
                      onChange={(e) =>
                        updateStop(dayIdx, stopIdx, { description: e.target.value })
                      }
                      placeholder="자유 관람 후 집합"
                      className={inputCls}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
