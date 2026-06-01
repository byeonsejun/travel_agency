import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted: vi.mock factory보다 먼저 실행됨을 보장
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enqueueProductEmbeddingJob: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
  db: {
    $transaction: vi.fn(),
    product: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    itineraryStop: { deleteMany: vi.fn(), createMany: vi.fn() },
    itineraryDay: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    productTag: { deleteMany: vi.fn(), createMany: vi.fn() },
    inclusion: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
}));

vi.mock("@/features/auth/server/auth", () => ({ auth: mocks.auth }));
vi.mock("@/shared/lib/db", () => ({ db: mocks.db }));
vi.mock("@/shared/lib/embedding-job/enqueue", () => ({
  enqueueProductEmbeddingJob: mocks.enqueueProductEmbeddingJob,
}));
vi.mock("next/cache", () => ({
  revalidateTag: mocks.revalidateTag,
  revalidatePath: mocks.revalidatePath,
  unstable_cache: <T extends (...a: never[]) => unknown>(fn: T) => fn,
}));

import {
  createProductAction,
  updateProductAction,
  publishProductAction,
  archiveProductAction,
} from "../actions";
import { productInputSchema } from "../../model/schemas";

// ── 공통 픽스처 ──────────────────────────────────────────────────
const ADMIN_ID = "cladmin0000000000000000001";
const PRODUCT_ID = "clproduct000000000000001";

const adminSession = {
  user: { id: ADMIN_ID, role: "ADMIN" as const },
};
const customerSession = {
  user: { id: "clcustomer00000000000001", role: "CUSTOMER" as const },
};

const validProductInput = {
  title: "오사카 완전정복 5일",
  summary: "오사카의 숨은 맛집과 명소를 모두 담은 완벽한 여행 패키지입니다.",
  destination: "오사카, 일본",
  destinationCode: undefined,
  durationNights: 4,
  durationDays: 5,
  heroImageUrl: undefined,
  basePriceAdult: 100000,
  status: "DRAFT" as const,
  tags: ["#가족", "#맛집"],
  inclusions: [],
  itineraryDays: [
    {
      dayNumber: 1,
      title: "인천 출발 → 오사카 도착",
      accommodation: "오사카 호텔",
      meals: { breakfast: undefined, lunch: undefined, dinner: "현지식" },
      stops: [
        { order: 0, time: "10:00", place: "인천공항", description: undefined },
      ],
    },
  ],
};

const mockCreatedProduct = {
  id: PRODUCT_ID,
  title: validProductInput.title,
  status: "DRAFT" as const,
};

// ══════════════════════════════════════════════════════════════════
// 1. productInputSchema — Zod 검증 단위 테스트
// ══════════════════════════════════════════════════════════════════
describe("productInputSchema", () => {
  // basePriceAdult — 4 케이스
  describe("basePriceAdult 검증", () => {
    it("float (100000.5) → 실패", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        basePriceAdult: 100000.5,
      });
      expect(result.success).toBe(false);
    });

    it("음수 (-1) → 실패", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        basePriceAdult: -1,
      });
      expect(result.success).toBe(false);
    });

    it("0 → 성공 (zero edge case)", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        basePriceAdult: 0,
      });
      expect(result.success).toBe(true);
    });

    it("양의 정수 (100000) → 성공", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        basePriceAdult: 100000,
      });
      expect(result.success).toBe(true);
    });
  });

  // itineraryDays 중첩 구조 — 5 케이스
  describe("itineraryDays 중첩 구조 검증", () => {
    it("빈 배열 ([]) → 실패 (min 1)", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        itineraryDays: [],
      });
      expect(result.success).toBe(false);
    });

    it("dayNumber: 0 → 실패 (min 1)", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        itineraryDays: [
          { ...validProductInput.itineraryDays[0]!, dayNumber: 0 },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("stops: [] → 성공 (stops은 비어도 됨)", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        itineraryDays: [
          { ...validProductInput.itineraryDays[0]!, stops: [] },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("stop.place: '' → 실패 (min 1)", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        itineraryDays: [
          {
            ...validProductInput.itineraryDays[0]!,
            stops: [{ order: 0, time: "10:00", place: "", description: undefined }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it("다중 day + 다중 stop smoke test → 성공", () => {
      const result = productInputSchema.safeParse({
        ...validProductInput,
        itineraryDays: [
          {
            dayNumber: 1,
            title: "1일차",
            accommodation: "호텔A",
            meals: { breakfast: "빵", lunch: "현지식", dinner: "한식" },
            stops: [
              { order: 0, time: "10:00", place: "공항", description: "도착" },
              { order: 1, time: "15:00", place: "호텔 체크인", description: undefined },
            ],
          },
          {
            dayNumber: 2,
            title: "2일차",
            accommodation: undefined,
            meals: { breakfast: undefined, lunch: undefined, dinner: undefined },
            stops: [
              { order: 0, time: "09:00", place: "관광지A", description: "유명 관광지" },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });
  });

  it("유효한 전체 객체 → 성공", () => {
    const result = productInputSchema.safeParse(validProductInput);
    expect(result.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// 2. createProductAction
// ══════════════════════════════════════════════════════════════════
describe("createProductAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // $transaction은 콜백 형태로 mock
    mocks.db.$transaction.mockImplementation(
      async (cb: (tx: typeof mocks.db) => Promise<unknown>) => cb(mocks.db),
    );
    mocks.db.product.create.mockResolvedValue(mockCreatedProduct);
    mocks.enqueueProductEmbeddingJob.mockResolvedValue(undefined);
  });

  // 3중 권한 가드
  it("세션 없음 → error (인증 필요)", async () => {
    mocks.auth.mockResolvedValue(null);

    const result = await createProductAction(null, validProductInput);

    expect(result.type).toBe("error");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("CUSTOMER role → error (권한 없음)", async () => {
    mocks.auth.mockResolvedValue(customerSession);

    const result = await createProductAction(null, validProductInput);

    expect(result.type).toBe("error");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("ADMIN + Zod 실패 (float price) → error + fieldErrors, DB 미호출", async () => {
    mocks.auth.mockResolvedValue(adminSession);

    const result = await createProductAction(null, {
      ...validProductInput,
      basePriceAdult: 100000.5,
    });

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.fieldErrors).toBeDefined();
    }
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("ADMIN + 유효 입력 → $transaction 1회 호출 + enqueue(tx, productId, actor) + revalidateTag×4", async () => {
    mocks.auth.mockResolvedValue(adminSession);

    const result = await createProductAction(null, validProductInput);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.productId).toBe(PRODUCT_ID);
    }

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.db.product.create).toHaveBeenCalledTimes(1);

    // enqueue는 tx 안에서 호출 (db와 동일한 mock tx 객체)
    expect(mocks.enqueueProductEmbeddingJob).toHaveBeenCalledWith(
      mocks.db,
      PRODUCT_ID,
      `admin:${ADMIN_ID}`,
    );

    // revalidateTag 4종
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(4);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/products");
  });

  it("success: { type: 'success', productId } 반환", async () => {
    mocks.auth.mockResolvedValue(adminSession);

    const result = await createProductAction(null, validProductInput);

    expect(result).toMatchObject({ type: "success", productId: PRODUCT_ID });
  });
});

// ══════════════════════════════════════════════════════════════════
// 3. updateProductAction
// ══════════════════════════════════════════════════════════════════
describe("updateProductAction", () => {
  const validUpdateInput = { ...validProductInput, productId: PRODUCT_ID };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(
      async (cb: (tx: typeof mocks.db) => Promise<unknown>) => cb(mocks.db),
    );
    mocks.db.product.findUnique.mockResolvedValue(mockCreatedProduct);
    mocks.db.product.update.mockResolvedValue({ ...mockCreatedProduct });
    mocks.enqueueProductEmbeddingJob.mockResolvedValue(undefined);
    mocks.db.itineraryStop.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.itineraryStop.createMany.mockResolvedValue({ count: 1 });
    mocks.db.itineraryDay.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.itineraryDay.createMany.mockResolvedValue({ count: 1 });
    mocks.db.itineraryDay.findMany.mockResolvedValue([
      { id: "cldayid00000000000000001", dayNumber: 1 },
    ]);
    mocks.db.productTag.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.productTag.createMany.mockResolvedValue({ count: 1 });
    mocks.db.inclusion.deleteMany.mockResolvedValue({ count: 0 });
    mocks.db.inclusion.createMany.mockResolvedValue({ count: 0 });
  });

  // 3중 권한 가드 (abbreviated)
  it("세션 없음 → error", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await updateProductAction(null, validUpdateInput);
    expect(result.type).toBe("error");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("CUSTOMER role → error", async () => {
    mocks.auth.mockResolvedValue(customerSession);
    const result = await updateProductAction(null, validUpdateInput);
    expect(result.type).toBe("error");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("ADMIN + 빈 itineraryDays → error (Zod 실패)", async () => {
    mocks.auth.mockResolvedValue(adminSession);

    const result = await updateProductAction(null, {
      ...validUpdateInput,
      itineraryDays: [],
    });

    expect(result.type).toBe("error");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("ADMIN + 유효 입력 → deleteMany→createMany 패턴 + enqueue + revalidateTag×4", async () => {
    mocks.auth.mockResolvedValue(adminSession);

    const result = await updateProductAction(null, validUpdateInput);

    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.productId).toBe(PRODUCT_ID);
    }

    expect(mocks.db.$transaction).toHaveBeenCalledTimes(1);

    // delete-then-create 패턴 검증
    expect(mocks.db.itineraryStop.deleteMany).toHaveBeenCalledWith({
      where: { day: { productId: PRODUCT_ID } },
    });
    expect(mocks.db.itineraryDay.deleteMany).toHaveBeenCalledWith({
      where: { productId: PRODUCT_ID },
    });
    expect(mocks.db.itineraryDay.createMany).toHaveBeenCalledTimes(1);

    expect(mocks.enqueueProductEmbeddingJob).toHaveBeenCalledWith(
      mocks.db,
      PRODUCT_ID,
      `admin:${ADMIN_ID}`,
    );
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(4);
  });

  it("product not found → error", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    mocks.db.product.findUnique.mockResolvedValue(null);

    const result = await updateProductAction(null, validUpdateInput);

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toMatch(/찾을 수 없|not found/i);
    }
  });
});

// ══════════════════════════════════════════════════════════════════
// 4. publishProductAction
// ══════════════════════════════════════════════════════════════════
describe("publishProductAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(
      async (cb: (tx: typeof mocks.db) => Promise<unknown>) => cb(mocks.db),
    );
    mocks.db.product.update.mockResolvedValue({
      ...mockCreatedProduct,
      status: "PUBLISHED",
    });
    mocks.enqueueProductEmbeddingJob.mockResolvedValue(undefined);
  });

  // 3중 권한 가드
  it("세션 없음 → error", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await publishProductAction(null, { productId: PRODUCT_ID });
    expect(result.type).toBe("error");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("CUSTOMER role → error", async () => {
    mocks.auth.mockResolvedValue(customerSession);
    const result = await publishProductAction(null, { productId: PRODUCT_ID });
    expect(result.type).toBe("error");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("ADMIN + invalid productId (non-cuid) → Zod error, NO db query", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    const result = await publishProductAction(null, { productId: "not-a-cuid" });
    expect(result.type).toBe("error");
    expect(mocks.db.product.findUnique).not.toHaveBeenCalled();
  });

  it("ADMIN + product 없음 → error", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    mocks.db.product.findUnique.mockResolvedValue(null);
    const result = await publishProductAction(null, { productId: PRODUCT_ID });
    expect(result.type).toBe("error");
  });

  it("DRAFT → PUBLISHED 성공 + enqueue + revalidateTag×4", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    mocks.db.product.findUnique.mockResolvedValue({
      ...mockCreatedProduct,
      status: "DRAFT",
    });

    const result = await publishProductAction(null, { productId: PRODUCT_ID });

    expect(result.type).toBe("success");
    expect(mocks.db.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_ID },
        data: expect.objectContaining({ status: "PUBLISHED" }),
      }),
    );
    expect(mocks.enqueueProductEmbeddingJob).toHaveBeenCalledWith(
      mocks.db,
      PRODUCT_ID,
      `admin:${ADMIN_ID}`,
    );
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(4);
  });

  it("이미 PUBLISHED → error (이미 게시됨)", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    mocks.db.product.findUnique.mockResolvedValue({
      ...mockCreatedProduct,
      status: "PUBLISHED",
    });

    const result = await publishProductAction(null, { productId: PRODUCT_ID });

    expect(result.type).toBe("error");
    if (result.type === "error") {
      expect(result.message).toMatch(/이미|publish/i);
    }
  });

  it("CLOSED 상태 → error (publish 불가)", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    mocks.db.product.findUnique.mockResolvedValue({
      ...mockCreatedProduct,
      status: "CLOSED",
    });

    const result = await publishProductAction(null, { productId: PRODUCT_ID });

    expect(result.type).toBe("error");
  });
});

// ══════════════════════════════════════════════════════════════════
// 5. archiveProductAction
// ══════════════════════════════════════════════════════════════════
describe("archiveProductAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.$transaction.mockImplementation(
      async (cb: (tx: typeof mocks.db) => Promise<unknown>) => cb(mocks.db),
    );
    mocks.db.product.update.mockResolvedValue({
      ...mockCreatedProduct,
      status: "CLOSED",
    });
  });

  // 권한 가드 (abbreviated)
  it("세션 없음 → error", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await archiveProductAction(null, { productId: PRODUCT_ID });
    expect(result.type).toBe("error");
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("CUSTOMER role → error", async () => {
    mocks.auth.mockResolvedValue(customerSession);
    const result = await archiveProductAction(null, { productId: PRODUCT_ID });
    expect(result.type).toBe("error");
  });

  it("ADMIN + invalid productId (non-cuid) → Zod error, NO db query", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    const result = await archiveProductAction(null, { productId: "../../etc/passwd" });
    expect(result.type).toBe("error");
    expect(mocks.db.product.findUnique).not.toHaveBeenCalled();
  });

  it("PUBLISHED → CLOSED 성공 + enqueue 미호출 + revalidateTag×4", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    mocks.db.product.findUnique.mockResolvedValue({
      ...mockCreatedProduct,
      status: "PUBLISHED",
    });

    const result = await archiveProductAction(null, { productId: PRODUCT_ID });

    expect(result.type).toBe("success");
    expect(mocks.db.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PRODUCT_ID },
        data: expect.objectContaining({ status: "CLOSED" }),
      }),
    );
    // archive는 enqueue 하지 않음
    expect(mocks.enqueueProductEmbeddingJob).not.toHaveBeenCalled();
    expect(mocks.revalidateTag).toHaveBeenCalledTimes(4);
  });

  it("DRAFT 상태 → error (archive 불가)", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    mocks.db.product.findUnique.mockResolvedValue({
      ...mockCreatedProduct,
      status: "DRAFT",
    });

    const result = await archiveProductAction(null, { productId: PRODUCT_ID });

    expect(result.type).toBe("error");
  });

  it("이미 CLOSED → error", async () => {
    mocks.auth.mockResolvedValue(adminSession);
    mocks.db.product.findUnique.mockResolvedValue({
      ...mockCreatedProduct,
      status: "CLOSED",
    });

    const result = await archiveProductAction(null, { productId: PRODUCT_ID });

    expect(result.type).toBe("error");
  });
});
