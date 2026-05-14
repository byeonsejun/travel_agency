import type { Metadata } from "next";
import { getCurrentUser } from "@/entities/user";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nextour — AI 패키지 여행 예약",
  description: "조건에 딱 맞는 패키지 여행을 AI가 찾아드립니다.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 진단 로그: getCurrentUser()가 RSC에서 정상 동작함을 매 요청마다 dev 콘솔에
  // 출력하여 세션 인식 여부를 사용자가 직접 확인할 수 있게 한다.
  // production 빌드에서는 출력 안 됨.
  if (process.env.NODE_ENV !== "production") {
    const user = await getCurrentUser();
    console.log("[RootLayout] getCurrentUser →", user);
  }
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
