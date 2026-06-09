import localFont from "next/font/local";

/** Pretendard Variable — 한글 본문 폰트. CSS 변수 --font-pretendard 로 노출. */
export const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});
