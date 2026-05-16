"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface Props {
  callbackUrl: string;
  email?: string;
}

interface SessionResponse {
  user?: { id?: string };
}

const POLL_INTERVAL_MS = 2500;

export function SessionPoll({ callbackUrl, email }: Props) {
  const router = useRouter();

  useEffect(() => {
    // email prop이 없으면 폴링 자체를 시작하지 않음. 의도하지 않은 위치에서
    // 마운트되거나 verify에 email query 없이 직접 진입한 경우의 안전장치.
    if (!email) return;

    let intervalId: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    function stop() {
      cancelled = true;
      if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
      }
    }

    async function check() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const data: SessionResponse | null = await res.json();
        if (cancelled) return;
        if (data?.user) {
          stop();
          router.replace(callbackUrl);
          // 공유 레이아웃((site)/layout.tsx)의 auth()는 Router Cache에
          // 묶여 클라이언트 네비게이션만으로 재실행되지 않는다. refresh로
          // RSC 페이로드를 무효화해 헤더가 즉시 로그인 상태로 갱신되게 한다.
          router.refresh();
        }
      } catch {
        // 일시적 네트워크 오류는 다음 폴링에서 재시도
      }
    }

    intervalId = setInterval(check, POLL_INTERVAL_MS);

    return stop;
  }, [callbackUrl, router, email]);

  if (!email) return null;

  return (
    <p className="text-xs text-gray-400">
      {`${email}의 인증을 자동으로 감지합니다.`}
    </p>
  );
}
