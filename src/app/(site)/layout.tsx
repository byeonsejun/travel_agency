import Link from "next/link";
import { auth } from "@/features/auth/server/auth";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

export default async function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const user = session?.user;

  return (
    <>
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="text-lg font-bold text-indigo-600 hover:text-indigo-700"
          >
            Nextour
          </Link>

          <nav className="flex items-center gap-2">
            {user ? (
              <>
                <span className="text-sm text-gray-600">
                  {user.name ?? user.email}
                </span>
                <Link
                  href="/mypage"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  마이페이지
                </Link>
                <LogoutButton />
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                로그인
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
