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
        }
      } catch {
        // 일시적 네트워크 오류는 다음 폴링에서 재시도
      }
    }

    intervalId = setInterval(check, POLL_INTERVAL_MS);

    return stop;
  }, [callbackUrl, router]);

  return (
    <p className="text-xs text-gray-400">
      {email
        ? `${email}의 인증을 자동으로 감지합니다.`
        : "인증 상태를 자동으로 감지합니다."}
    </p>
  );
}
