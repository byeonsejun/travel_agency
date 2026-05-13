export default function VerifyPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-4 rounded-xl bg-white px-8 py-10 shadow text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
          <svg
            className="h-7 w-7 text-blue-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-bold">이메일을 확인하세요</h1>
        <p className="text-sm text-gray-500">
          입력하신 이메일로 로그인 링크를 보냈습니다.
          <br />
          링크를 클릭하면 자동으로 로그인됩니다.
        </p>
        <p className="text-xs text-gray-400">
          이메일이 오지 않으면 스팸함을 확인해 주세요.
        </p>
        <a
          href="/login"
          className="block text-sm text-blue-600 hover:underline"
        >
          다시 시도하기
        </a>
      </div>
    </main>
  );
}
