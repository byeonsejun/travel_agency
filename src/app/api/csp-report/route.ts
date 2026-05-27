import { NextResponse } from "next/server";
import { z } from "zod";
import { captureMessage } from "@/shared/lib/observability";
import { logger } from "@/shared/lib/observability/logger";

/**
 * CSP Level 2 report-uri payload schema.
 * - 모든 필드 optional — 브라우저 구현 편차 흡수
 * - 필드별 길이 상한 — 악의적 100MB JSON 차단
 */
const cspReportSchema = z.object({
  "csp-report": z.object({
    "document-uri": z.string().max(2048).optional(),
    "referrer": z.string().max(2048).optional(),
    "violated-directive": z.string().max(256).optional(),
    "effective-directive": z.string().max(256).optional(),
    "original-policy": z.string().max(4096).optional(),
    "disposition": z.enum(["report", "enforce"]).optional(),
    "blocked-uri": z.string().max(2048).optional(),
    "line-number": z.number().int().nonnegative().optional(),
    "column-number": z.number().int().nonnegative().optional(),
    "source-file": z.string().max(2048).optional(),
    "status-code": z.number().int().optional(),
    "script-sample": z.string().max(512).optional(),
  }),
});

/**
 * 브라우저 확장프로그램 · AdBlock 의 노이즈 패턴.
 * 사용자 시스템 잡음이라 Sentry 로 보내봤자 actionable 하지 않다 — quota 보호.
 */
const NOISE_BLOCKED_URI_PATTERNS = [
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /^safari-extension:/i,
  /^safari-web-extension:/i,
  /^webkit-masked-url:/i,
  /^about:/i,
];

const NOISE_SOURCE_FILE_PATTERNS = [
  /^chrome-extension:/i,
  /^moz-extension:/i,
  /^safari-extension:/i,
];

type CspReportInner = z.infer<typeof cspReportSchema>["csp-report"];

function isNoiseReport(report: CspReportInner): boolean {
  const blocked = report["blocked-uri"] ?? "";
  const source = report["source-file"] ?? "";
  return (
    NOISE_BLOCKED_URI_PATTERNS.some((re) => re.test(blocked)) ||
    NOISE_SOURCE_FILE_PATTERNS.some((re) => re.test(source))
  );
}

export const runtime = "nodejs"; // ALS/errorTracker 의존 → Edge 금지

export async function POST(req: Request): Promise<NextResponse> {
  const contentType = req.headers.get("content-type") ?? "";
  const validContentType =
    contentType.includes("application/csp-report") ||
    contentType.includes("application/json");
  if (!validContentType) {
    return NextResponse.json({ ok: false }, { status: 415 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const parsed = cspReportSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn("csp.report.invalid_payload", { error: parsed.error.flatten() });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const report = parsed.data["csp-report"];

  if (isNoiseReport(report)) {
    logger.debug("csp.report.noise_filtered", {
      blockedUri: report["blocked-uri"],
      sourceFile: report["source-file"],
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let blockedOrigin = "";
  try {
    blockedOrigin = new URL(report["blocked-uri"] ?? "").origin;
  } catch {
    blockedOrigin = report["blocked-uri"] ?? "unknown";
  }

  captureMessage(
    `CSP violation: ${report["violated-directive"]} blocked ${blockedOrigin}`,
    "warn",
    {
      extras: {
        cspViolatedDirective: report["violated-directive"],
        cspBlockedUri: report["blocked-uri"],
        cspDocumentUri: report["document-uri"],
        cspSourceFile: report["source-file"],
        cspDisposition: report["disposition"],
      },
    },
  );

  return NextResponse.json({ ok: true }, { status: 200 });
}
