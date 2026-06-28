import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Button,
  Link,
  Hr,
} from "@react-email/components";
import type { MagicLinkEmailProps } from "./types";

// 브랜드 블루 — globals.css `--primary: 219 100% 53%` (A1 클린 블루)와 동일 색.
// 메일 클라이언트는 CSS 변수/HSL을 못 읽으므로 hex로 고정한다.
const BRAND_BLUE = "#0f63ff";
const INK = "#0f172a";
const MUTED = "#64748b";

/**
 * 매직링크 로그인 메일. `url`은 Auth.js가 생성한 값을 그대로 버튼/평문 링크에 연결만
 * 한다(토큰·URL 가공 없음). 모바일 메일 클라이언트 호환을 위해 전부 인라인 스타일 +
 * React Email 프리미티브(Section/Button 등)로 작성.
 */
export function MagicLinkEmail({ url, expiresInHours }: MagicLinkEmailProps) {
  const year = new Date().getFullYear();
  return (
    <Html lang="ko">
      <Head />
      <Preview>Nextour 로그인 링크가 도착했어요</Preview>
      <Body
        style={{
          backgroundColor: "#f4f4f5",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: "32px 0",
        }}
      >
        {/* 헤더 브랜드 바 — 형제 메일(예약/환불)과 동일 프레임 */}
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: INK,
            borderRadius: "12px 12px 0 0",
            padding: "24px 32px",
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontSize: "20px",
              fontWeight: "700",
              margin: 0,
              letterSpacing: "-0.3px",
            }}
          >
            Nextour
          </Text>
        </Container>

        {/* 본문 카드 */}
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: "#ffffff",
            padding: "40px 32px",
          }}
        >
          <Heading
            style={{
              fontSize: "24px",
              fontWeight: "700",
              color: INK,
              margin: "0 0 12px",
            }}
          >
            로그인 링크가 도착했어요
          </Heading>
          <Text
            style={{
              color: MUTED,
              fontSize: "15px",
              lineHeight: "1.6",
              margin: "0 0 28px",
            }}
          >
            아래 버튼을 눌러 Nextour에 로그인하세요. 비밀번호는 필요하지 않습니다.
          </Text>

          {/* CTA 버튼 — 브랜드 블루 */}
          <Section style={{ textAlign: "center", margin: "0 0 28px" }}>
            <Button
              href={url}
              style={{
                backgroundColor: BRAND_BLUE,
                color: "#ffffff",
                fontSize: "16px",
                fontWeight: "600",
                textDecoration: "none",
                padding: "14px 32px",
                borderRadius: "10px",
                display: "inline-block",
              }}
            >
              로그인하기
            </Button>
          </Section>

          {/* 평문 링크 fallback (버튼 미동작 대비) */}
          <Text
            style={{
              color: MUTED,
              fontSize: "13px",
              lineHeight: "1.6",
              margin: "0 0 8px",
            }}
          >
            버튼이 동작하지 않으면 아래 주소를 복사해 브라우저에 붙여넣으세요.
          </Text>
          <Text
            style={{
              margin: "0 0 28px",
              padding: "12px 14px",
              backgroundColor: "#f8fafc",
              borderRadius: "8px",
              wordBreak: "break-all",
            }}
          >
            <Link
              href={url}
              style={{ color: BRAND_BLUE, fontSize: "13px", textDecoration: "none" }}
            >
              {url}
            </Link>
          </Text>

          {/* 만료 안내 */}
          <Section
            style={{
              backgroundColor: "#eff6ff",
              borderRadius: "8px",
              padding: "16px 20px",
              marginBottom: "28px",
            }}
          >
            <Text
              style={{
                color: "#1e40af",
                fontSize: "13px",
                lineHeight: "1.6",
                margin: 0,
              }}
            >
              이 링크는 <strong>{`${expiresInHours}시간 동안`}</strong> 유효하며, 한
              번 사용하면 만료됩니다.
            </Text>
          </Section>

          <Hr style={{ borderColor: "#e2e8f0", margin: "0 0 24px" }} />

          {/* 보안 문구 */}
          <Text
            style={{
              color: "#94a3b8",
              fontSize: "12px",
              lineHeight: "1.6",
              margin: 0,
            }}
          >
            본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다. 링크를 사용하지 않는
            한 계정은 안전합니다. 이 메일은 발신 전용입니다.
          </Text>
        </Container>

        {/* 푸터 */}
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: "#f8fafc",
            borderRadius: "0 0 12px 12px",
            padding: "20px 32px",
            textAlign: "center",
          }}
        >
          <Text style={{ color: "#94a3b8", fontSize: "11px", margin: 0 }}>
            © {year} Nextour
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
