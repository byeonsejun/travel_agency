import { AuthSuccessClient } from "@/features/auth/ui/AuthSuccessClient";

interface Props {
  searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function LoginSuccessPage({ searchParams }: Props) {
  const { callbackUrl } = await searchParams;
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : "/";

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-gray-50">
      <AuthSuccessClient callbackUrl={safeCallback} />
    </div>
  );
}
