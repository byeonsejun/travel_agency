import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  createDeparture: vi.fn(),
  updateDeparture: vi.fn(),
  transitionDepartureStatus: vi.fn(),
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
}));
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

import { createDepartureAction, updateDepartureAction } from "../actions";
import { CapacityBelowBookedError } from "@/entities/departure";

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
    expect(mocks.revalidateTag).toHaveBeenCalledWith("product:prod_1:departures");
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
});
