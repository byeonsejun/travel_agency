import type { Metadata } from "next";
import { pretendard } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nextour — AI 패키지 여행 예약",
  description: "조건에 딱 맞는 패키지 여행을 AI가 찾아드립니다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: 브라우저 확장(Tag Assistant 등)이 hydration 전에 <html> 에
    // data-* 속성을 주입해 생기는 경고만 무시. 이 요소 자신의 속성에만 적용(자식 트리 검사 유지).
    <html lang="ko" className={pretendard.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
