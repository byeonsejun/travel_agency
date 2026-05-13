import { AuthSuccessClient } from "@/features/auth/ui/AuthSuccessClient";

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function LoginSuccessPage({ searchParams }: Props) {
  const { callbackUrl } = await searchParams;
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50">
      <AuthSuccessClient callbackUrl={safeCallback} />
    </main>
  );
}
