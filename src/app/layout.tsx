import type { Metadata } from "next";
import { getCurrentUser } from "@/entities/user";
import { logger } from "@/shared/lib/observability";
import { pretendard } from "./fonts";
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
  if (process.env.NODE_ENV !== "production") {
    const user = await getCurrentUser();
    logger.debug("layout.root.user_resolved", { userId: user?.id ?? null });
  }
  return (
    <html lang="ko" className={pretendard.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
