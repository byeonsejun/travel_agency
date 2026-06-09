import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, OAuthLoginButtons } from "@/features/auth";
import { safeCallbackPath } from "@/shared/lib/security";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";

interface Props {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}

const ERROR_MESSAGES: Record<string, string> = {
  // allowDangerousEmailAccountLinking 로 일반적으로는 발생하지 않지만,
  // IdP가 이메일을 제공하지 않는 예외 케이스를 대비한 잔존 안전망.
  OAuthAccountNotLinked: "이미 다른 방식으로 가입된 이메일입니다.",
  InvalidProvider: "지원하지 않는 로그인 방식입니다.",
  Default: "로그인에 실패했습니다. 다시 시도해 주세요.",
};

export default async function LoginPage({ searchParams }: Props) {
  const { callbackUrl, error } = await searchParams;
  const safeCallback = safeCallbackPath(callbackUrl);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-secondary px-6 py-16">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-border bg-card px-8 py-10 shadow-card">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">로그인</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            이메일로 로그인 링크를 받으세요
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
            {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default}
          </p>
        )}

        <form
          action={async (formData: FormData) => {
            "use server";
            const email = formData.get("email") as string;
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
              className="block text-sm font-medium text-foreground"
            >
              이메일
            </label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="hello@example.com"
              className="mt-1.5"
            />
          </div>
          <Button type="submit" className="w-full">
            이메일로 링크 받기
          </Button>
        </form>

        <OAuthLoginButtons callbackUrl={safeCallback} />
      </div>
    </div>
  );
}
