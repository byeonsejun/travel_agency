import type { NextRequest } from "next/server";
import { handlers } from "@/features/auth/server/auth";

const { GET: originalGET, POST } = handlers;

export const GET = async (req: NextRequest) => {
  if (process.env.NODE_ENV !== "production") {
    const url = new URL(req.url);
    console.log("[NextAuth route] GET", url.pathname, {
      ua: req.headers.get("user-agent")?.slice(0, 80) ?? "—",
      referer: req.headers.get("referer") ?? "—",
      hasCookie: !!req.headers.get("cookie"),
      secFetchSite: req.headers.get("sec-fetch-site") ?? "—",
      secFetchMode: req.headers.get("sec-fetch-mode") ?? "—",
    });
  }
  return originalGET(req);
};

export { POST };
