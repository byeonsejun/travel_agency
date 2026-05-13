import { signIn } from "@/features/auth/server/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked: "이미 다른 방식으로 가입된 이메일입니다.",
  Default: "로그인에 실패했습니다. 다시 시도해 주세요.",
};

export default async function LoginPage({ searchParams }: Props) {
  const { callbackUrl = "/", error } = await searchParams;
  const hasKakao = !!(process.env.AUTH_KAKAO_ID && process.env.AUTH_KAKAO_SECRET);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-white px-8 py-10 shadow">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">로그인</h1>
          <p className="mt-1 text-sm text-gray-500">
            이메일로 로그인 링크를 받으세요
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default}
          </p>
        )}

        <form
          action={async (formData: FormData) => {
            "use server";
            const email = formData.get("email") as string;
            const safeCallback = callbackUrl.startsWith("/") ? callbackUrl : "/";
            const successUrl = `/login/success?callbackUrl=${encodeURIComponent(safeCallback)}`;
            try {
              await signIn("resend", {
                email,
                redirect: false,
                redirectTo: successUrl,
              });
            } catch (e) {
              if (e instanceof AuthError) {
                redirect(
                  `/login?error=${encodeURIComponent(e.type)}&callbackUrl=${encodeURIComponent(safeCallback)}`
                );
              }
              throw e;
            }
            redirect(
              `/login/verify?callbackUrl=${encodeURIComponent(safeCallback)}&email=${encodeURIComponent(email)}`
            );
          }}
          className="space-y-4"
        >
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              이메일
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="hello@example.com"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            이메일로 링크 받기
          </button>
        </form>

        {hasKakao && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs text-gray-400">
                <span className="bg-white px-2">또는</span>
              </div>
            </div>

            <form
              action={async () => {
                "use server";
                await signIn("kakao", { redirectTo: callbackUrl });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#FEE500] px-4 py-2.5 text-sm font-semibold text-[#3C1E1E] hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2"
              >
                카카오로 로그인
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
