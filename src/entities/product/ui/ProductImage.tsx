import Image from "next/image";

type ProductImageProps = {
  src?: string | null;
  alt: string;
  className?: string;
};

export function ProductImage({ src, alt, className = "" }: ProductImageProps) {
  // src가 없으면 회색 div + alt 텍스트 중앙 표시
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-200 ${className}`}
      >
        <p className="text-center text-sm text-gray-600">{alt}</p>
      </div>
    );
  }

  // src가 있으면 next/image 사용, fill 레이아웃
  return (
    <div className={`relative ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover"
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
      />
    </div>
  );
}
