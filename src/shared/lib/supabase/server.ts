// Supabase 서버 전용 클라이언트.
//
// `SERVICE_ROLE_KEY`는 RLS를 bypass하는 권한이므로 **절대 클라이언트 번들에
// 노출되어선 안 된다**. 두 겹의 가드로 차단한다:
//   1) `import "server-only"` — 클라이언트 컴포넌트가 import 시 빌드 단계에서
//      Next.js가 에러를 던진다 (정적 격리, 가장 강력한 방어).
//   2) `SUPABASE_SERVICE_ROLE_KEY`는 `NEXT_PUBLIC_` prefix가 없으므로 Next 빌드가
//      클라이언트 번들에 자동 포함하지 않는다 (env 격리, runtime fallback).
//
// env 미설정 시 fail-fast — server action 호출 한참 후에 cryptic 오류로 터지는
// 것보다 부팅·첫 호출 시점에 명확한 메시지로 막는 게 낫다.

import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/shared/lib/env";

let cached: SupabaseClient | undefined;

export function createServerSupabase(): SupabaseClient {
  if (cached) return cached;

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "[supabase] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. " +
        "Set both in .env before invoking server-side Supabase operations.",
    );
  }

  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      // 서버 service-role 클라이언트는 stateless — 세션 영속화·자동 갱신 비활성.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cached;
}
