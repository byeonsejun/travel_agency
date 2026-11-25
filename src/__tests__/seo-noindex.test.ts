import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NOINDEX_METADATA } from "@/shared/lib/seo";
import BookingsLayout, { metadata as bookingsMetadata } from "@/app/(site)/bookings/layout";
import LoginLayout, { metadata as loginMetadata } from "@/app/(site)/login/layout";
import MypageLayout, { metadata as mypageMetadata } from "@/app/(site)/mypage/layout";
import CheckoutLayout, { metadata as checkoutMetadata } from "@/app/(site)/products/[id]/checkout/layout";
import ReviewsLayout, { metadata as reviewsMetadata } from "@/app/(site)/reviews/layout";

// JSX 없이 createElement 로 쓴다. 이 파일은 .ts 이기 때문이다.
const NOINDEX = { robots: { index: false, follow: false } };

const LAYOUTS = [
  { name: "bookings", Layout: BookingsLayout, metadata: bookingsMetadata },
  { name: "login", Layout: LoginLayout, metadata: loginMetadata },
  { name: "mypage", Layout: MypageLayout, metadata: mypageMetadata },
  { name: "products/[id]/checkout", Layout: CheckoutLayout, metadata: checkoutMetadata },
  { name: "reviews", Layout: ReviewsLayout, metadata: reviewsMetadata },
];

describe("비공개 화면 noindex layout", () => {
  it("NOINDEX_METADATA 는 index 와 follow 를 모두 막는다", () => {
    expect(NOINDEX_METADATA).toEqual(NOINDEX);
  });

  for (const { name, Layout, metadata } of LAYOUTS) {
    describe(name, () => {
      it("metadata.robots 가 noindex, nofollow 다", () => {
        expect(metadata.robots).toEqual({ index: false, follow: false });
      });

      it("children 을 그대로 돌려준다", () => {
        const html = renderToStaticMarkup(createElement(Layout, null, createElement("p", null, "x")));
        expect(html).toBe("<p>x</p>");
      });
    });
  }
});
