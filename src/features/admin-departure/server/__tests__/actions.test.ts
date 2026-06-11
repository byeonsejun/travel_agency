import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  createDeparture: vi.fn(),
  updateDeparture: vi.fn(),
  transitionDepartureStatus: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/entities/departure", async (orig) => {
  const actual = await orig<typeof import("@/entities/departure")>();
  return {
    ...actual,
    createDeparture: mocks.createDeparture,
    updateDeparture: mocks.updateDeparture,
    transitionDepartureStatus: mocks.transitionDepartureStatus,
    tagDeparturesByProduct: (pid: string) => `product:${pid}:departures`,
  };
});

import {
  createDepartureAction,
  updateDepartureAction,
  transitionDepartureAction,
} from "../actions";
import {
  CapacityBelowBookedError,
  DepartureDateConflictError,
  DepartureHasBookingsError,
} from "@/entities/departure";

const validInput = {
  departureDate: new Date("2026-09-01"),
  returnDate: new Date("2026-09-05"),
  priceAdult: 1_000_000,
  priceChild: 700_000,
  priceInfant: 0,
  capacity: 20,
  minPax: 4,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
});

describe("createDepartureAction", () => {
  it("ADMIN 아니면 forbidden", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "CUSTOMER" } });
    const res = await createDepartureAction("prod_1", null, validInput);
    expect(res.type).toBe("error");
    expect(mocks.createDeparture).not.toHaveBeenCalled();
  });

  it("Zod 실패 → fieldErrors", async () => {
    const bad = { ...validInput, capacity: 0 };
    const res = await createDepartureAction("prod_1", null, bad);
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.fieldErrors).toBeDefined();
    expect(mocks.createDeparture).not.toHaveBeenCalled();
  });

  it("성공 → createDeparture 호출 + revalidate 2종", async () => {
    mocks.createDeparture.mockResolvedValue("dep_new");
    const res = await createDepartureAction("prod_1", null, validInput);
    expect(res.type).toBe("success");
    expect(mocks.createDeparture).toHaveBeenCalledWith("prod_1", expect.any(Object));
    expect(mocks.revalidateTag).toHaveBeenCalledWith("product:prod_1:departures", "max");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/products/prod_1");
  });
});

describe("updateDepartureAction — 도메인 에러 매핑", () => {
  it("CapacityBelowBookedError → 사용자 메시지", async () => {
    mocks.updateDeparture.mockRejectedValue(new CapacityBelowBookedError("dep_1"));
    const res = await updateDepartureAction("dep_1", "prod_1", null, validInput);
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.message).toContain("예약");
  });

  it("DepartureDateConflictError → 날짜 메시지", async () => {
    mocks.updateDeparture.mockRejectedValue(new DepartureDateConflictError());
    const res = await updateDepartureAction("dep_1", "prod_1", null, validInput);
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.message).toContain("날짜");
  });

  it("DepartureHasBookingsError → 예약 건수 포함", async () => {
    mocks.updateDeparture.mockRejectedValue(new DepartureHasBookingsError("dep_1", 3));
    const res = await updateDepartureAction("dep_1", "prod_1", null, validInput);
    expect(res.type).toBe("error");
    if (res.type === "error") expect(res.message).toContain("3");
  });
});

describe("transitionDepartureAction — form action + redirect", () => {
  // departureTransitionSchema는 cuid를 요구하므로 유효한 cuid 사용
  const DEP = "cjld2cjxh0000qzrmn831i7rn";
  const PROD = "cjld2cyuq0000t3rmniod1foy";
  function fd(to: string) {
    const f = new FormData();
    f.set("departureId", DEP);
    f.set("productId", PROD);
    f.set("to", to);
    return f;
  }

  it("비-ADMIN → /admin/products 로 redirect", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "CUSTOMER" } });
    await expect(transitionDepartureAction(fd("CLOSED"))).rejects.toThrow(
      "REDIRECT:/admin/products",
    );
    expect(mocks.transitionDepartureStatus).not.toHaveBeenCalled();
  });

  it("FormData 파싱 실패(잘못된 id) → /admin/products 로 redirect", async () => {
    const f = new FormData();
    f.set("departureId", "bad");
    f.set("productId", "bad");
    f.set("to", "CLOSED");
    await expect(transitionDepartureAction(f)).rejects.toThrow(
      "REDIRECT:/admin/products",
    );
    expect(mocks.transitionDepartureStatus).not.toHaveBeenCalled();
  });

  it("성공 → 전이 + revalidate + 목록으로 redirect", async () => {
    mocks.transitionDepartureStatus.mockResolvedValue(undefined);
    await expect(transitionDepartureAction(fd("CLOSED"))).rejects.toThrow(
      `REDIRECT:/admin/products/${PROD}/departures`,
    );
    expect(mocks.transitionDepartureStatus).toHaveBeenCalledWith(DEP, "CLOSED");
    expect(mocks.revalidateTag).toHaveBeenCalledWith(`product:${PROD}:departures`, "max");
  });

  it("DepartureHasBookingsError → edit?error=has_bookings 로 redirect", async () => {
    mocks.transitionDepartureStatus.mockRejectedValue(
      new DepartureHasBookingsError(DEP, 2),
    );
    await expect(transitionDepartureAction(fd("CANCELED"))).rejects.toThrow(
      `REDIRECT:/admin/products/${PROD}/departures/${DEP}/edit?error=has_bookings`,
    );
  });
});
