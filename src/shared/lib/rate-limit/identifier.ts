import type { IdStrategy } from "./tiers";

export function getClientIp(req: Request): string {
  const xvff = req.headers.get("x-vercel-forwarded-for");
  if (xvff) return xvff.split(",")[0].trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export function identify(
  req: Request,
  strategy: IdStrategy,
  userId: string | null | undefined,
): string {
  if (strategy !== "ipOnly" && userId) {
    return `user:${userId}`;
  }
  if (strategy === "userOnly") {
    throw new Error("UNAUTHENTICATED");
  }
  return `ip:${getClientIp(req)}`;
}

export function hashIdForLog(id: string): string {
  const idx = id.indexOf(":");
  if (idx === -1) return id;
  const scope = id.slice(0, idx);
  const val = id.slice(idx + 1);
  if (val.length <= 6) return `${scope}:${val.slice(0, 2)}...`;
  return `${scope}:${val.slice(0, 4)}...${val.slice(-2)}`;
}
