import Link from "next/link";

interface Props {
  searchParams: Promise<{ error?: string }>;
}

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  Verification: {
    title: "링크가 만료되었습니다",
    description: "로그인 링크의 유효 기간이 지났거나 이미 사용되었습니다. 다시 시도해 주세요.",
  },
  AccessDenied: {
    title: "인증이 거부되었습니다",
    description: "로그인 과정에서 인증이 취소되었습니다.",
  },
  OAuthAccountNotLinked: {
    title: "이미 다른 방식으로 가입된 이메일입니다",
    description: "처음 가입할 때 사용한 로그인 방식으로 다시 시도해 주세요.",
  },
  Configuration: {
    title: "설정 오류",
    description: "서비스 설정에 문제가 있습니다. 잠시 후 다시 시도해 주세요.",
  },
  Default: {
    title: "로그인에 실패했습니다",
    description: "잠시 후 다시 시도해 주세요.",
  },
};

export default async function LoginErrorPage({ searchParams }: Props) {
  const { error } = await searchParams;
  const message = ERROR_MESSAGES[error ?? "Default"] ?? ERROR_MESSAGES.Default;

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 rounded-xl bg-white px-8 py-10 shadow text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
          <svg
            className="h-7 w-7 text-red-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-bold">{message.title}</h1>
          <p className="text-sm text-gray-500">{message.description}</p>
        </div>
        <Link
          href="/login"
          className="block w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          로그인으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
