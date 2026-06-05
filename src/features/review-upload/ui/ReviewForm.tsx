"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  isAllowedMime,
  MAX_REVIEW_PHOTOS,
  type AllowedReviewPhotoMime,
} from "../model/photoSlots";
import {
  signReviewPhotoUploads,
  submitReview,
  type ReviewActionError,
} from "../server/actions";

// 클라이언트 측 파일 크기 상한. Vercel function 4.5MB 제한은 Presigned URL 우회로
// 적용되지 않지만, UX 안전판 + Supabase 무료 티어(5MB) 호환성을 위해 10MB로 가드.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const CONTENT_MAX = 1000;

type Phase = "idle" | "signing" | "uploading" | "submitting";

type Props = {
  bookingId: string;
};

const ERROR_MESSAGES: Record<ReviewActionError, string> = {
  NOT_OWNER: "본인의 예약에만 후기를 작성할 수 있습니다.",
  NOT_COMPLETED: "여행이 완료된 예약에만 후기를 작성할 수 있습니다.",
  ALREADY_REVIEWED: "이미 후기가 작성된 예약입니다.",
  INVALID: "입력값을 다시 확인해 주세요.",
  UNAUTHORIZED: "로그인이 필요합니다.",
  RATE_LIMITED: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
};

export function ReviewForm({ bookingId }: Props) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ObjectURL lifecycle — files 가 바뀌면 (1) 이전 effect 의 cleanup 이 직전 URL
  // 들을 revoke, (2) 새 effect 가 새 URL 들을 생성. 컴포넌트 unmount 시에도
  // cleanup 이 호출되어 메모리 누수 0건. (Frontend Expert critical rule)
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const submitting = phase !== "idle" || isPending;
  const contentTrimmed = content.trim();
  const canSubmit =
    !submitting &&
    rating >= 1 &&
    rating <= 5 &&
    contentTrimmed.length >= 1 &&
    contentTrimmed.length <= CONTENT_MAX;

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = ""; // 같은 파일 재선택 가능하도록 input 초기화
    setErrorMsg(null);

    const remaining = MAX_REVIEW_PHOTOS - files.length;
    if (remaining <= 0) {
      setErrorMsg(`사진은 최대 ${MAX_REVIEW_PHOTOS}장까지 첨부 가능합니다.`);
      return;
    }

    const accepted: File[] = [];
    for (const f of picked.slice(0, remaining)) {
      if (!isAllowedMime(f.type)) {
        setErrorMsg("지원되지 않는 형식입니다. (JPG·PNG·WebP만 가능)");
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        setErrorMsg("사진 한 장은 10MB를 넘을 수 없습니다.");
        continue;
      }
      accepted.push(f);
    }

    if (accepted.length === 0) return;
    setFiles((prev) => [...prev, ...accepted]);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;

    setErrorMsg(null);
    startTransition(async () => {
      try {
        // ── Step 1: signed upload URL 발급 ─────────────────────────
        setPhase("signing");
        const photoMetas = files.map((f, idx) => ({
          idx,
          mime: f.type as AllowedReviewPhotoMime,
        }));
        const signResult = await signReviewPhotoUploads({
          bookingId,
          photoMetas,
        });
        if (!signResult.ok) {
          setErrorMsg(ERROR_MESSAGES[signResult.error]);
          setPhase("idle");
          return;
        }
        const { pendingReviewId, slots } = signResult;

        // ── Step 2: Supabase Storage 직접 PUT (병렬) ────────────────
        setPhase("uploading");
        setUploadProgress({ done: 0, total: slots.length });
        let done = 0;
        await Promise.all(
          slots.map(async (slot) => {
            const file = files[slot.idx];
            const res = await fetch(slot.signedUrl, {
              method: "PUT",
              headers: { "Content-Type": file.type },
              body: file,
            });
            if (!res.ok) {
              throw new Error(`사진 업로드 실패 (${slot.idx + 1}번째)`);
            }
            done += 1;
            setUploadProgress({ done, total: slots.length });
          }),
        );

        // ── Step 3: Review + ReviewPhoto[] atomic create ────────────
        setPhase("submitting");
        const submitResult = await submitReview({
          pendingReviewId,
          bookingId,
          rating,
          content: contentTrimmed,
          paths: slots.map((s) => ({ path: s.path, order: s.idx })),
        });
        if (!submitResult.ok) {
          setErrorMsg(ERROR_MESSAGES[submitResult.error]);
          setPhase("idle");
          return;
        }

        // 성공: PDP 로 이동. router.push 가 RSC 재요청을 트리거해 신규 review 노출.
        router.push(`/products/${submitResult.productId}`);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : "후기 등록에 실패했습니다. 잠시 후 다시 시도해 주세요.",
        );
        setPhase("idle");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* 별점 */}
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700">
          별점 <span className="text-red-500">*</span>
        </legend>
        <div
          className="mt-2 flex items-center gap-1"
          onMouseLeave={() => setHoverRating(0)}
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const active = (hoverRating || rating) >= n;
            return (
              <button
                key={n}
                type="button"
                aria-label={`${n}점`}
                aria-pressed={rating === n}
                onMouseEnter={() => setHoverRating(n)}
                onClick={() => setRating(n)}
                disabled={submitting}
                className="p-1 disabled:opacity-50"
              >
                <svg
                  viewBox="0 0 20 20"
                  className={`h-8 w-8 ${
                    active ? "fill-amber-400" : "fill-gray-200"
                  }`}
                  aria-hidden="true"
                >
                  <path d="M9.05.927C9.349.012 10.651.012 10.95.927l1.713 5.272a1 1 0 00.95.69h5.546c.962 0 1.362 1.232.586 1.798l-4.488 3.26a1 1 0 00-.364 1.118l1.713 5.272c.299.916-.756 1.677-1.539 1.118l-4.488-3.26a1 1 0 00-1.175 0l-4.488 3.26c-.783.56-1.838-.202-1.539-1.118l1.713-5.272a1 1 0 00-.364-1.118L2.255 8.687c-.776-.566-.377-1.798.586-1.798h5.547a1 1 0 00.949-.69L9.05.927z" />
                </svg>
              </button>
            );
          })}
          <span className="ml-3 text-sm text-gray-500">
            {rating > 0 ? `${rating} / 5` : "별점을 선택해주세요"}
          </span>
        </div>
      </fieldset>

      {/* 후기 내용 */}
      <div>
        <label
          htmlFor="content"
          className="block text-sm font-medium text-gray-700"
        >
          후기 내용 <span className="text-red-500">*</span>
        </label>
        <textarea
          id="content"
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, CONTENT_MAX))}
          disabled={submitting}
          rows={6}
          placeholder="여행은 어떠셨나요? 다른 여행자에게 도움이 될 만한 후기를 남겨주세요."
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50"
        />
        <div className="mt-1 flex justify-between text-xs text-gray-400">
          <span>최소 1자 이상</span>
          <span>
            {contentTrimmed.length} / {CONTENT_MAX}
          </span>
        </div>
      </div>

      {/* 사진 (선택, max 5) */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          사진{" "}
          <span className="text-xs font-normal text-gray-400">
            (선택 · 최대 {MAX_REVIEW_PHOTOS}장 · 한 장 10MB 이하)
          </span>
        </label>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {previewUrls.map((url, idx) => (
            <div
              key={url}
              className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`업로드 미리보기 ${idx + 1}`}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeFile(idx)}
                disabled={submitting}
                aria-label={`사진 ${idx + 1} 삭제`}
                className="absolute right-1 top-1 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white opacity-0 transition group-hover:opacity-100 disabled:opacity-0"
              >
                ✕
              </button>
            </div>
          ))}
          {files.length < MAX_REVIEW_PHOTOS && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-3xl text-gray-400 hover:border-indigo-400 hover:text-indigo-500 disabled:opacity-50"
            >
              +
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleFilePick}
          className="hidden"
        />
      </div>

      {/* 에러 / 진행 상태 메시지 */}
      {errorMsg && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700"
        >
          {errorMsg}
        </p>
      )}
      {phase === "signing" && (
        <p className="text-sm text-gray-500">사진 업로드 URL 발급 중…</p>
      )}
      {phase === "uploading" && (
        <p className="text-sm text-gray-500">
          사진 업로드 중 {uploadProgress.done} / {uploadProgress.total}
        </p>
      )}
      {phase === "submitting" && (
        <p className="text-sm text-gray-500">후기 저장 중…</p>
      )}

      {/* 제출 */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? "처리 중…" : "후기 등록"}
        </button>
      </div>
    </form>
  );
}
