"use client";

import { useState } from "react";
import Image from "next/image";
import { Lightbox, type LightboxImage } from "./Lightbox";

type Props = {
  images: LightboxImage[];
};

// 자기완결형 썸네일 그리드. 클릭 시 자체 state 로 Lightbox 오픈.
// PDP 리뷰 카드·admin 상세 양쪽이 콜백 없이 그대로 사용 (review-feed/admin 무관).
export function PhotoGrid({ images }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (images.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {images.map((img, i) => (
          <button
            type="button"
            key={img.id}
            onClick={() => setOpenIndex(i)}
            className="relative aspect-square overflow-hidden rounded-lg border border-gray-100"
            aria-label={`${img.alt} 확대`}
          >
            <Image
              src={img.url}
              alt={img.alt}
              fill
              sizes="(min-width: 640px) 120px, 33vw"
              className="object-cover transition-transform duration-150 hover:scale-105"
            />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <Lightbox
          images={images}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onIndexChange={setOpenIndex}
        />
      )}
    </>
  );
}
