"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

export type LightboxImage = { id: string; url: string; alt: string };

type Props = {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
};

// 도메인 무지 이미지 라이트박스. PDP 리뷰 피드·admin 상세가 공유.
// 메모리 누수 차단(프론트 영구 수칙): keydown 리스너·body scroll lock 은
// effect cleanup 에서 반드시 원복.
export function Lightbox({ images, index, onClose, onIndexChange }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight")
        onIndexChange((index + 1) % images.length);
      else if (e.key === "ArrowLeft")
        onIndexChange((index - 1 + images.length) % images.length);
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, images.length, onClose, onIndexChange]);

  const current = images[index];
  if (!current) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="사진 확대 보기"
      tabIndex={-1}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-white hover:bg-white/20"
      >
        ✕
      </button>

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative h-[80vh] w-full max-w-4xl"
      >
        <Image
          src={current.url}
          alt={current.alt}
          fill
          sizes="(min-width: 768px) 896px, 100vw"
          className="object-contain transition-transform duration-200"
        />
      </div>

      {images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="이전 사진"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index - 1 + images.length) % images.length);
            }}
            className="absolute left-4 rounded-full bg-white/10 px-4 py-2 text-2xl text-white hover:bg-white/20"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="다음 사진"
            onClick={(e) => {
              e.stopPropagation();
              onIndexChange((index + 1) % images.length);
            }}
            className="absolute right-4 rounded-full bg-white/10 px-4 py-2 text-2xl text-white hover:bg-white/20"
          >
            ›
          </button>
          <span className="absolute bottom-4 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
            {index + 1} / {images.length}
          </span>
        </>
      )}
    </div>
  );
}
