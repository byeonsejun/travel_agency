"use client";

import { useEffect } from "react";

interface Props {
  callbackUrl: string;
  email?: string;
}

interface SessionResponse {
  user?: { id?: string };
}

const POLL_INTERVAL_MS = 2500;

export function SessionPoll({ callbackUrl, email }: Props) {
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
          // 하드 내비게이션(SPA replace 아님): 헤더의 UserNavIsland 는
          // mount 시 1회만 /api/auth/session 을 fetch 하는 client island 라,
          // router.replace + router.refresh(RSC 재실행)로는 재mount/재fetch
          // 되지 않아 헤더가 로그아웃 상태로 고착된다(ADR-0018 격리의 부작용).
          // 전체 페이지 이동으로 island 를 재mount → 세션 재fetch → 로그인
          // 헤더가 정확히 반영된다. callbackUrl 은 항상 내부 경로(safeCallback).
          window.location.assign(callbackUrl);
        }
      } catch {
        // 일시적 네트워크 오류는 다음 폴링에서 재시도
      }
    }

    intervalId = setInterval(check, POLL_INTERVAL_MS);

    return stop;
  }, [callbackUrl, email]);

  if (!email) return null;

  return (
    <p className="text-xs text-gray-400">
      {`${email}의 인증을 자동으로 감지합니다.`}
    </p>
  );
}
