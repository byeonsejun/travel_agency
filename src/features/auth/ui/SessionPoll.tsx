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
const DEV = process.env.NODE_ENV !== "production";

export function SessionPoll({ callbackUrl, email }: Props) {
  const router = useRouter();

  useEffect(() => {
    // 가드: email prop이 없으면 폴링 자체를 시작하지 않음.
    // verify 페이지에서 email query 없이 진입한 경우(직접 URL 입력 등) 또는
    // 의도하지 않은 위치에서 마운트된 경우 네트워크 호출을 방지한다.
    if (!email) {
      if (DEV) {
        console.warn("[SessionPoll] no email prop — polling skipped");
      }
      return;
    }

    if (DEV) {
      console.log("[SessionPoll] MOUNT", {
        pathname:
          typeof window !== "undefined" ? window.location.pathname : "(ssr)",
        email,
      });
    }

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
          if (DEV) {
            console.log(
              "[SessionPoll] session detected → navigate to",
              callbackUrl,
            );
          }
          stop();
          router.replace(callbackUrl);
        }
      } catch {
        // 일시적 네트워크 오류는 다음 폴링에서 재시도
      }
    }

    intervalId = setInterval(check, POLL_INTERVAL_MS);

    return () => {
      if (DEV) {
        console.log("[SessionPoll] UNMOUNT");
      }
      stop();
    };
  }, [callbackUrl, router, email]);

  if (!email) return null;

  return (
    <p className="text-xs text-gray-400">
      {`${email}의 인증을 자동으로 감지합니다.`}
    </p>
  );
}
