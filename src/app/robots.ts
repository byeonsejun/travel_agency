import type { MetadataRoute } from "next";
import { absoluteUrl, isPreviewDeployment } from "@/shared/lib/seo";

// 비공개 화면(/mypage, /checkout 등)은 여기서 막지 않는다. robots.txt 로 막으면
// 검색 로봇이 페이지를 열지 못해 그 페이지의 noindex 를 읽지 못한다.
// 막는 것은 화면이 아닌 /api/ 뿐이다. 미리보기 배포는 통째로 막는다.
export function buildRobots(preview: boolean): MetadataRoute.Robots {
  if (preview) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}

export default function robots(): MetadataRoute.Robots {
  return buildRobots(isPreviewDeployment());
}
