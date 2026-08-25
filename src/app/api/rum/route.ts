/**
 * POST /api/rum — Web Vitals 비콘 수집 (RUM).
 * fire-and-forget: 정상 204, 검증 실패 400(클라는 sendBeacon이라 응답 무시).
 * rate-limit: rum tier(60/min IP, fail-open). route는 서버 화이트리스트로 재검증.
 * runtime=nodejs: Prisma 사용.
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRateLimit } from "@/shared/lib/rate-limit";
import { db } from "@/shared/lib/db";
import { webVitalSchema, coerceRouteTemplate, ratingFor } from "@/features/rum";


export const POST = withRateLimit(
  { tier: "rum" },
  async (req: NextRequest): Promise<NextResponse> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new NextResponse(null, { status: 400 });
    }

    const parsed = webVitalSchema.safeParse(body);
    if (!parsed.success) {
      return new NextResponse(null, { status: 400 });
    }

    const { metric, value, navType } = parsed.data;
    await db.webVitalEvent.create({
      data: {
        metric,
        value,
        rating: ratingFor(metric, value),
        route: coerceRouteTemplate(parsed.data.route),
        navType: navType ?? null,
      },
    });

    return new NextResponse(null, { status: 204 });
  },
);
