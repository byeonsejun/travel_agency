import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Row,
  Column,
  Heading,
  Text,
  Hr,
  Link,
} from "@react-email/components";
import type { BookingConfirmationEmailProps } from "./types";

const won = (n: number) =>
  n.toLocaleString("ko-KR") + "원";

export function BookingConfirmationEmail({
  customerName,
  bookingId,
  productTitle,
  departureDate,
  travelerCount,
  totalPrice,
  receiptUrl,
}: BookingConfirmationEmailProps) {
  return (
    <Html lang="ko">
      <Head />
      <Preview>{productTitle} 예약이 확정되었습니다</Preview>
      <Body
        style={{
          backgroundColor: "#f4f4f5",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          padding: "32px 0",
        }}
      >
        {/* 헤더 브랜드 바 */}
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            backgroundColor: "#0f172a",
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
          {/* 확정 배지 */}
          <Section style={{ textAlign: "center", marginBottom: "32px" }}>
            <Text
              style={{
                display: "inline-block",
                backgroundColor: "#dcfce7",
                color: "#15803d",
                fontSize: "13px",
                fontWeight: "600",
                padding: "4px 14px",
                borderRadius: "999px",
                margin: "0 0 16px",
              }}
            >
              ✓ 예약 확정
            </Text>
            <Heading
              style={{
                fontSize: "24px",
                fontWeight: "700",
                color: "#0f172a",
                margin: "0 0 8px",
              }}
            >
              예약이 확정되었습니다
            </Heading>
            <Text
              style={{ color: "#64748b", fontSize: "15px", margin: 0 }}
            >
              {customerName}님, 결제가 완료되어 여행이 확정되었어요.
            </Text>
          </Section>

          <Hr style={{ borderColor: "#e2e8f0", margin: "0 0 28px" }} />

          {/* 상품 정보 박스 */}
          <Section
            style={{
              backgroundColor: "#f8fafc",
              borderRadius: "10px",
              padding: "20px 24px",
              marginBottom: "28px",
            }}
          >
            <Text
              style={{
                fontSize: "11px",
                fontWeight: "600",
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.8px",
                margin: "0 0 12px",
              }}
            >
              예약 정보
            </Text>
            <Row style={{ marginBottom: "10px" }}>
              <Column style={{ width: "40%" }}>
                <Text
                  style={{ color: "#64748b", fontSize: "13px", margin: 0 }}
                >
                  상품
                </Text>
              </Column>
              <Column>
                <Text
                  style={{
                    color: "#0f172a",
                    fontSize: "14px",
                    fontWeight: "600",
                    margin: 0,
                  }}
                >
                  {productTitle}
                </Text>
              </Column>
            </Row>
            <Row style={{ marginBottom: "10px" }}>
              <Column style={{ width: "40%" }}>
                <Text
                  style={{ color: "#64748b", fontSize: "13px", margin: 0 }}
                >
                  출발일
                </Text>
              </Column>
              <Column>
                <Text
                  style={{ color: "#0f172a", fontSize: "14px", margin: 0 }}
                >
                  {departureDate}
                </Text>
              </Column>
            </Row>
            <Row style={{ marginBottom: "10px" }}>
              <Column style={{ width: "40%" }}>
                <Text
                  style={{ color: "#64748b", fontSize: "13px", margin: 0 }}
                >
                  여행 인원
                </Text>
              </Column>
              <Column>
                <Text
                  style={{ color: "#0f172a", fontSize: "14px", margin: 0 }}
                >
                  {travelerCount}명
                </Text>
              </Column>
            </Row>
            <Row>
              <Column style={{ width: "40%" }}>
                <Text
                  style={{ color: "#64748b", fontSize: "13px", margin: 0 }}
                >
                  예약번호
                </Text>
              </Column>
              <Column>
                <Text
                  style={{
                    color: "#6366f1",
                    fontSize: "13px",
                    fontFamily: "monospace",
                    margin: 0,
                  }}
                >
                  {bookingId}
                </Text>
              </Column>
            </Row>
          </Section>

          {/* 결제 금액 강조 */}
          <Section
            style={{
              borderLeft: "4px solid #6366f1",
              paddingLeft: "16px",
              marginBottom: "28px",
            }}
          >
            <Text
              style={{ color: "#64748b", fontSize: "13px", margin: "0 0 4px" }}
            >
              결제 금액
            </Text>
            <Text
              style={{
                color: "#0f172a",
                fontSize: "26px",
                fontWeight: "700",
                margin: 0,
              }}
            >
              {won(totalPrice)}
            </Text>
          </Section>

          {/* 영수증 링크 */}
          {receiptUrl ? (
            <Section
              style={{
                backgroundColor: "#f0f9ff",
                borderRadius: "8px",
                padding: "16px 20px",
                marginBottom: "28px",
              }}
            >
              <Text
                style={{ color: "#0369a1", fontSize: "13px", margin: "0 0 8px" }}
              >
                결제 영수증을 확인하세요
              </Text>
              <Link
                href={receiptUrl}
                style={{
                  color: "#0284c7",
                  fontSize: "13px",
                  textDecoration: "underline",
                  wordBreak: "break-all",
                }}
              >
                {receiptUrl}
              </Link>
            </Section>
          ) : null}

          <Hr style={{ borderColor: "#e2e8f0", margin: "0 0 24px" }} />

          <Text
            style={{ color: "#94a3b8", fontSize: "12px", lineHeight: "1.6", margin: 0 }}
          >
            출발 전 여권 유효기간을 확인해 주세요. 문의사항이 있으시면 고객센터로
            연락해 주세요. 이 메일은 발신 전용입니다.
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
          <Text
            style={{ color: "#94a3b8", fontSize: "11px", margin: 0 }}
          >
            © 2026 Nextour. All rights reserved.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
