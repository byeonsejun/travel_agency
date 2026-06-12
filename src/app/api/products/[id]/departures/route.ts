import { NextResponse } from "next/server";
import { z } from "zod";
import { listDepartureSeats } from "@/entities/departure";

// 폴링 전용 엔드포인트 — 항상 신선한 좌석 데이터를 응답한다.
// route handler는 기본 비prerender(동적) + 응답 no-store 헤더로 어떤 캐시도 거치지 않는다.

const ParamsSchema = z.object({ id: z.string().cuid() });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  // Next 15: params는 Promise
  const raw = await params;
  const parsed = ParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "INVALID_PRODUCT_ID" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const seats = await listDepartureSeats(parsed.data.id);

  return NextResponse.json(
    { departures: seats },
    {
      headers: {
        // 모든 캐시 레이어(브라우저, Next, CDN) 우회.
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
