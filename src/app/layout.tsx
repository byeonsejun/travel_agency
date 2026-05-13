import type { Metadata } from "next";
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
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
