"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProductDetail } from "@/entities/product";
import type { ProductInput, UpdateProductInput } from "../model/schemas";
import {
  createProductAction,
  updateProductAction,
} from "../server/actions";
import type { CreateProductState, UpdateProductState } from "../server/actions";
import { ItineraryEditor } from "./ItineraryEditor";
import type { ItineraryDayInput } from "./ItineraryEditor";

// Props 
type ProductFormProps =
  | { mode: "create"; initial?: undefined }
  | { mode: "edit"; initial: ProductDetail };

// 초기화 헬퍼 

function emptyProductInput(): ProductInput {
  return {
    title: "",
    summary: "",
    destination: "",
    destinationCode: undefined,
    durationNights: 1,
    durationDays: 2,
    heroImageUrl: undefined,
    basePriceAdult: 0,
    status: "DRAFT",
    tags: [],
    inclusions: [],
    itineraryDays: [],
  };
}

/**
 * ProductDetail(Prisma 조인 결과) → ProductInput(form state) 변환.
 * edit 모드에서 기존 데이터를 폼에 채울 때 사용.
 */
export function productDetailToInput(d: ProductDetail): ProductInput {
  return {
    title: d.title,
    summary: d.summary,
    destination: d.destination,
    destinationCode: d.destinationCode ?? undefined,
    durationNights: d.durationNights,
    durationDays: d.durationDays,
    heroImageUrl: d.heroImageUrl ?? undefined,
    basePriceAdult: d.basePriceAdult,
    status: d.status,
    tags: d.tags.map((t) => t.tag),
    inclusions: d.inclusions.map((inc) => ({
      kind: inc.kind,
      label: inc.label,
      note: inc.note ?? undefined,
    })),
    itineraryDays: [...d.itineraryDays]
      .sort((a, b) => a.dayNumber - b.dayNumber)
      .map((day) => ({
        dayNumber: day.dayNumber,
        title: day.title,
        accommodation: day.accommodation ?? undefined,
        meals: day.meals as { breakfast?: string; lunch?: string; dinner?: string },
        stops: [...day.stops]
          .sort((a, b) => a.order - b.order)
          .map((stop) => ({
            order: stop.order,
            time: stop.time ?? undefined,
            place: stop.place,
            description: stop.description ?? undefined,
          })),
      })),
  };
}

// inclusion row 타입 
type InclusionRow = ProductInput["inclusions"][number];

function emptyInclusion(): InclusionRow {
  return { kind: "INCLUDED", label: "", note: "" };
}

// 내부 shared form 상태 타입 
type FormBodyProps = {
  state: CreateProductState | UpdateProductState | null;
  isPending: boolean;
  onSubmit: (payload: ProductInput) => void;
  initial: ProductDetail | undefined;
  mode: "create" | "edit";
};

// FormBody: 두 모드에서 재사용하는 실제 렌더링 
function FormBody({ state, isPending, onSubmit, initial, mode }: FormBodyProps) {
  const [form, setForm] = useState<ProductInput>(() =>
    initial ? productDetailToInput(initial) : emptyProductInput(),
  );

  // tags — comma-separated UX
  const [tagsRaw, setTagsRaw] = useState<string>(
    () => (initial ? initial.tags.map((t) => t.tag).join(", ") : ""),
  );

  // inclusions — 동적 row 배열
  const [inclusions, setInclusions] = useState<InclusionRow[]>(
    () => (initial ? productDetailToInput(initial).inclusions : []),
  );

  const fieldErrors =
    state?.type === "error" ? (state.fieldErrors ?? {}) : undefined;

  // ── itinerary controlled ────────────────────────────────────────
  function handleItineraryChange(days: ItineraryDayInput[]) {
    setForm((prev) => ({ ...prev, itineraryDays: days }));
  }

  // ── submit ─────────────────────────────────────────────────────
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // tags: raw 문자열 → 배열 (쉼표 구분, 빈값 제거)
    const tags = tagsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    onSubmit({ ...form, tags, inclusions });
  }

  // ── helpers ───────────────────────────────────────────────────
  function setField<K extends keyof ProductInput>(key: K, value: ProductInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function addInclusion() {
    setInclusions((prev) => [...prev, emptyInclusion()]);
  }

  function removeInclusion(idx: number) {
    setInclusions((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateInclusion(idx: number, patch: Partial<InclusionRow>) {
    setInclusions((prev) =>
      prev.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    );
  }

  // ── CSS helpers ───────────────────────────────────────────────
  const inputCls =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400";
  const labelCls = "mb-1 block text-sm font-medium text-gray-700";
  const errorCls = "mt-1 text-xs text-red-600";
  const sectionCls = "rounded-xl border border-gray-200 bg-white p-5 space-y-4";

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── 전역 서버 에러 ── */}
      {state?.type === "error" && (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.message}
        </p>
      )}

      {/* ══ 기본 정보 ══ */}
      <section className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900">기본 정보</h2>

        {/* 상품명 */}
        <div>
          <label className={labelCls} htmlFor="title">
            상품명 *
          </label>
          <input
            id="title"
            type="text"
            value={form.title}
            onChange={(e) => setField("title", e.target.value)}
            placeholder="예: 도쿄 4박 5일 패키지"
            className={inputCls}
          />
          {fieldErrors?.title && (
            <p className={errorCls}>{fieldErrors.title[0]}</p>
          )}
        </div>

        {/* 요약 */}
        <div>
          <label className={labelCls} htmlFor="summary">
            요약 *
          </label>
          <textarea
            id="summary"
            value={form.summary}
            onChange={(e) => setField("summary", e.target.value)}
            rows={3}
            placeholder="상품 요약 설명 (10자 이상)"
            className={inputCls}
          />
          {fieldErrors?.summary && (
            <p className={errorCls}>{fieldErrors.summary[0]}</p>
          )}
        </div>

        {/* 목적지 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="destination">
              목적지 *
            </label>
            <input
              id="destination"
              type="text"
              value={form.destination}
              onChange={(e) => setField("destination", e.target.value)}
              placeholder="도쿄"
              className={inputCls}
            />
            {fieldErrors?.destination && (
              <p className={errorCls}>{fieldErrors.destination[0]}</p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="destinationCode">
              목적지 코드
            </label>
            <input
              id="destinationCode"
              type="text"
              value={form.destinationCode ?? ""}
              onChange={(e) =>
                setField("destinationCode", e.target.value || undefined)
              }
              placeholder="JP-TYO"
              className={inputCls}
            />
          </div>
        </div>

        {/* 기간 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls} htmlFor="durationNights">
              박수 *
            </label>
            <input
              id="durationNights"
              type="number"
              min={1}
              value={form.durationNights}
              onChange={(e) =>
                setField("durationNights", parseInt(e.target.value, 10) || 1)
              }
              className={inputCls}
            />
            {fieldErrors?.durationNights && (
              <p className={errorCls}>{fieldErrors.durationNights[0]}</p>
            )}
          </div>
          <div>
            <label className={labelCls} htmlFor="durationDays">
              일수 *
            </label>
            <input
              id="durationDays"
              type="number"
              min={1}
              value={form.durationDays}
              onChange={(e) =>
                setField("durationDays", parseInt(e.target.value, 10) || 1)
              }
              className={inputCls}
            />
            {fieldErrors?.durationDays && (
              <p className={errorCls}>{fieldErrors.durationDays[0]}</p>
            )}
          </div>
        </div>

        {/* 가격 */}
        <div>
          <label className={labelCls} htmlFor="basePriceAdult">
            성인 기본가 (원) *
          </label>
          <input
            id="basePriceAdult"
            type="number"
            min={0}
            step={1}
            value={form.basePriceAdult}
            onChange={(e) =>
              setField("basePriceAdult", parseInt(e.target.value, 10) || 0)
            }
            className={inputCls}
          />
          {fieldErrors?.basePriceAdult && (
            <p className={errorCls}>{fieldErrors.basePriceAdult[0]}</p>
          )}
        </div>

        {/* Hero Image URL (YAGNI: 업로드는 Task 9, 여기서는 URL 직접 입력) */}
        <div>
          <label className={labelCls} htmlFor="heroImageUrl">
            대표 이미지 URL
          </label>
          <input
            id="heroImageUrl"
            type="url"
            value={form.heroImageUrl ?? ""}
            onChange={(e) =>
              setField("heroImageUrl", e.target.value || undefined)
            }
            placeholder="https://..."
            className={inputCls}
          />
          {fieldErrors?.heroImageUrl && (
            <p className={errorCls}>{fieldErrors.heroImageUrl[0]}</p>
          )}
        </div>

        {/* 상태 */}
        <div>
          <label className={labelCls} htmlFor="status">
            상태 *
          </label>
          <select
            id="status"
            value={form.status}
            onChange={(e) =>
              setField("status", e.target.value as ProductInput["status"])
            }
            className={inputCls}
          >
            <option value="DRAFT">DRAFT (임시저장)</option>
            <option value="PUBLISHED">PUBLISHED (게시)</option>
            <option value="CLOSED">CLOSED (보관)</option>
          </select>
        </div>
      </section>

      {/* ══ 태그 ══ */}
      <section className={sectionCls}>
        <h2 className="text-base font-semibold text-gray-900">태그</h2>
        <div>
          <label className={labelCls} htmlFor="tags">
            태그 (쉼표로 구분) *
          </label>
          <input
            id="tags"
            type="text"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="도쿄, 온천, 미식"
            className={inputCls}
          />
          {fieldErrors?.tags && (
            <p className={errorCls}>{fieldErrors.tags[0]}</p>
          )}
          {tagsRaw && (
            <p className="mt-1 text-xs text-gray-400">
              미리보기:{" "}
              {tagsRaw
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
                .map((tag) => (
                  <span
                    key={tag}
                    className="mr-1 inline-block rounded bg-indigo-50 px-2 py-0.5 text-indigo-700"
                  >
                    {tag}
                  </span>
                ))}
            </p>
          )}
        </div>
      </section>

      {/* ══ 포함/불포함 ══ */}
      <section className={sectionCls}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">포함/불포함 항목</h2>
          <button
            type="button"
            onClick={addInclusion}
            className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            + 항목 추가
          </button>
        </div>

        {inclusions.length === 0 && (
          <p className="text-sm text-gray-400">항목이 없습니다.</p>
        )}

        {inclusions.map((inc, idx) => (
          <div key={idx} className="grid grid-cols-12 gap-2 items-start">
            <div className="col-span-2">
              <label
                className="mb-1 block text-xs font-medium text-gray-500"
                htmlFor={`inc-kind-${idx}`}
              >
                종류
              </label>
              <select
                id={`inc-kind-${idx}`}
                value={inc.kind}
                onChange={(e) =>
                  updateInclusion(idx, { kind: e.target.value as "INCLUDED" | "EXCLUDED" })
                }
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <option value="INCLUDED">포함</option>
                <option value="EXCLUDED">불포함</option>
              </select>
            </div>
            <div className="col-span-4">
              <label
                className="mb-1 block text-xs font-medium text-gray-500"
                htmlFor={`inc-label-${idx}`}
              >
                항목명 *
              </label>
              <input
                id={`inc-label-${idx}`}
                type="text"
                value={inc.label}
                onChange={(e) => updateInclusion(idx, { label: e.target.value })}
                placeholder="항공권"
                className={inputCls}
              />
            </div>
            <div className="col-span-5">
              <label
                className="mb-1 block text-xs font-medium text-gray-500"
                htmlFor={`inc-note-${idx}`}
              >
                비고
              </label>
              <input
                id={`inc-note-${idx}`}
                type="text"
                value={inc.note ?? ""}
                onChange={(e) => updateInclusion(idx, { note: e.target.value })}
                placeholder="이코노미 클래스"
                className={inputCls}
              />
            </div>
            <div className="col-span-1 flex items-end pb-0.5">
              <button
                type="button"
                onClick={() => removeInclusion(idx)}
                aria-label="항목 삭제"
                className="mt-5 rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-600 hover:bg-red-100"
              >
                ✕
              </button>
            </div>
          </div>
        ))}

        {fieldErrors?.inclusions && (
          <p className={errorCls}>{fieldErrors.inclusions[0]}</p>
        )}
      </section>

      {/* ══ 일정 ══ */}
      <section className={sectionCls}>
        <ItineraryEditor
          days={form.itineraryDays}
          onChange={handleItineraryChange}
          fieldErrors={fieldErrors}
        />
      </section>

      {/* ══ 제출 ══ */}
      <div className="sticky bottom-4 rounded-xl border border-gray-200 bg-white p-4 shadow-md">
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
        >
          {isPending
            ? "저장 중..."
            : mode === "edit"
              ? "상품 수정 저장"
              : "상품 등록"}
        </button>
      </div>
    </form>
  );
}

// CreateForm — create 모드 전용 (useActionState 타입을 분리)
function CreateForm() {
  const router = useRouter();
  const [state, dispatch, isPending] = useActionState(createProductAction, null);

  // 성공 시 navigation은 render 중이 아닌 effect에서 수행해야 한다.
  // render 중 router.push는 StrictMode/Concurrent에서 중복 호출 위험.
  useEffect(() => {
    if (state?.type === "success") {
      router.push(`/admin/products/${state.productId}/edit`);
    }
  }, [state, router]);

  function handleSubmit(payload: ProductInput) {
    startTransition(() => {
      dispatch(payload);
    });
  }

  if (state?.type === "success") {
    return (
      <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
        저장됨 — 이동 중...
      </div>
    );
  }

  return (
    <FormBody
      state={state}
      isPending={isPending}
      onSubmit={handleSubmit}
      initial={undefined}
      mode="create"
    />
  );
}

// EditForm — edit 모드 전용 (productId 포함 payload)
function EditForm({ initial }: { initial: ProductDetail }) {
  const router = useRouter();
  const [state, dispatch, isPending] = useActionState(updateProductAction, null);

  useEffect(() => {
    if (state?.type === "success") {
      router.push(`/admin/products/${state.productId}/edit`);
    }
  }, [state, router]);

  function handleSubmit(payload: ProductInput) {
    const updatePayload: UpdateProductInput = { ...payload, productId: initial.id };
    startTransition(() => {
      dispatch(updatePayload);
    });
  }

  if (state?.type === "success") {
    return (
      <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
        저장됨 — 이동 중...
      </div>
    );
  }

  return (
    <FormBody
      state={state}
      isPending={isPending}
      onSubmit={handleSubmit}
      initial={initial}
      mode="edit"
    />
  );
}

// 공개 API: ProductForm (mode에 따라 분기)
export function ProductForm(props: ProductFormProps) {
  if (props.mode === "edit") {
    return <EditForm initial={props.initial} />;
  }
  return <CreateForm />;
}
