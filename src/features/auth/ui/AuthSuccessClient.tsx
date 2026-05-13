"use client";

import { useEffect, useState } from "react";

interface Props {
  callbackUrl: string;
}

export function AuthSuccessClient({ callbackUrl }: Props) {
  const [closeFailed, setCloseFailed] = useState(false);

  useEffect(() => {
    const closeTimer = setTimeout(() => {
      try {
        window.close();
      } catch {
        // 브라우저가 차단하면 catch
      }
      // window.close()가 차단된 경우 이 검증 콜백이 실행됨
      const verifyTimer = setTimeout(() => setCloseFailed(true), 250);
      return () => clearTimeout(verifyTimer);
    }, 600);
    return () => clearTimeout(closeTimer);
  }, []);

  return (
    <div className="w-full max-w-sm space-y-6 rounded-xl bg-white px-8 py-10 shadow text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
        <svg
          className="h-7 w-7 text-green-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-bold">인증이 완료되었습니다</h1>
        <p className="text-sm text-gray-500">
          이 창을 닫고 원래 화면으로 돌아가세요.
        </p>
      </div>
      {closeFailed && (
        <div className="space-y-2 border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-400">
            탭이 자동으로 닫히지 않으면 직접 닫아 주세요.
          </p>
          <a
            href={callbackUrl}
            className="block text-sm text-blue-600 hover:underline"
          >
            이 창에서 계속하기 →
          </a>
        </div>
      )}
    </div>
  );
}
