import { env } from "@/shared/lib/env";
import { signInWithProvider } from "../server/actions";

type Props = {
  callbackUrl: string;
};

/**
 * PRD §4.2 — 소셜 로그인 버튼 묶음 (RSC).
 * env 페어 검증 통과 + 모두 설정된 provider만 렌더한다.
 * env superRefine 이 한쪽만 설정된 케이스를 부팅에서 차단하므로 여기서는
 * 단순 truthy 체크만으로 충분.
 */
export function OAuthLoginButtons({ callbackUrl }: Props) {
  const hasKakao = !!(env.AUTH_KAKAO_ID && env.AUTH_KAKAO_SECRET);
  const hasGoogle = !!(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

  if (!hasKakao && !hasGoogle) return null;

  return (
    <div className="space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs text-gray-400">
          <span className="bg-white px-2">또는</span>
        </div>
      </div>

      {hasKakao && (
        <form action={signInWithProvider}>
          <input type="hidden" name="provider" value="kakao" />
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#FEE500] px-4 py-2.5 text-sm font-semibold text-[#3C1E1E] hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2"
          >
            <span aria-hidden="true" className="text-base">💬</span>
            카카오로 로그인
          </button>
        </form>
      )}

      {hasGoogle && (
        <form action={signInWithProvider}>
          <input type="hidden" name="provider" value="google" />
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {/* Google "G" 마크 — 외부 의존성 0 */}
            <svg
              aria-hidden="true"
              viewBox="0 0 18 18"
              className="h-4 w-4"
            >
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.96v2.331A8.997 8.997 0 0 0 9 18Z"
              />
              <path
                fill="#FBBC05"
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.96A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.96 4.042l3.004-2.332Z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .96 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
              />
            </svg>
            Google로 로그인
          </button>
        </form>
      )}
    </div>
  );
}
