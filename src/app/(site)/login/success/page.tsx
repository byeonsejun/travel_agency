import { Suspense } from "react";
import { AuthSuccessClient } from "@/features/auth";

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

// [ADR-0053] searchParams는 동적 → <Suspense> 안에서만 await.
export default function LoginSuccessPage({ searchParams }: Props) {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-gray-50">
      <Suspense
        fallback={
          <div className="h-32 w-full max-w-sm animate-pulse rounded-xl bg-gray-100" />
        }
      >
        <LoginSuccessInner searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LoginSuccessInner({ searchParams }: Props) {
  const { callbackUrl } = await searchParams;
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return <AuthSuccessClient callbackUrl={safeCallback} />;
}
