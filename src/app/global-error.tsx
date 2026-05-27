"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/**
 * global-error.tsx — root layout 사고 시 유일한 fallback.
 *
 * Next 15 App Router 사양: root layout이 throw하면 (site)/error.tsx로 잡히지 않는다.
 * 이 컴포넌트는 outer chrome(<html><body>)이 부재한 상황을 가정하므로 반드시 직접 렌더.
 *
 * errorTracker(server-only, ALS 의존) 대신 @sentry/nextjs의 isomorphic API를 직접 호출.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
            예기치 못한 오류가 발생했습니다
          </h1>
          <p style={{ color: "#666", marginBottom: "1.5rem" }}>
            잠시 후 다시 시도해주세요. 문제가 지속되면 고객센터로 문의해주세요.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: "0.5rem 1rem",
              border: "1px solid #333",
              borderRadius: "4px",
              background: "#fff",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </main>
      </body>
    </html>
  );
}
