"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  callbackUrl: string;
  email?: string;
}

const POLL_INTERVAL_MS = 2500;

export function SessionPoll({ callbackUrl, email }: Props) {
  const router = useRouter();
  const stoppedRef = useRef(false);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      if (stoppedRef.current) return;
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (res.ok) {
          const data: unknown = await res.json().catch(() => null);
          if (
            data &&
            typeof data === "object" &&
            "user" in data &&
            (data as { user: unknown }).user
          ) {
            stoppedRef.current = true;
            setDetected(true);
            router.replace(callbackUrl);
            router.refresh();
            return;
          }
        }
      } catch {
        // 네트워크 오류는 무시하고 다음 폴링에서 재시도
      }
      timer = setTimeout(check, POLL_INTERVAL_MS);
    }

    timer = setTimeout(check, POLL_INTERVAL_MS);
    return () => {
      stoppedRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [callbackUrl, router]);

  if (detected) {
    return (
      <p className="text-xs text-green-600">
        인증이 완료되었습니다. 잠시 후 자동으로 이동합니다…
      </p>
    );
  }

  return (
    <p className="text-xs text-gray-400">
      {email ? (
        <>
          이 페이지는 <strong>{email}</strong>의 인증을 자동으로 감지합니다.
        </>
      ) : (
        "이 페이지는 인증 상태를 자동으로 감지합니다."
      )}
    </p>
  );
}
