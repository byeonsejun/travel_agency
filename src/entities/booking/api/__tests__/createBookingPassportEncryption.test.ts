/**
 * TDD: Traveler.passportNo 암호화 검증
 *
 * createBooking이 $transaction 내에서 booking.create를 호출할 때,
 * travelers의 passportNo가 encrypt()된 값으로 저장되는지 확인한다.
 * 실제 crypto 모듈을 사용(vi.mock 없음) — vitest.setup.ts의 ENCRYPTION_KEY 더미 키 활용.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// --- db 모킹 (vi.hoisted로 $transaction 콜백 캡처) ---
const mocks = vi.hoisted(() => {
  const tx = {
    booking: { create: vi.fn() },
    bookingEvent: { create: vi.fn() },
  };

  return { tx };
});

vi.mock("@/shared/lib/db", () => ({
  db: {
    departure: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        priceAdult: 1_000_000,
        priceChild: 700_000,
        priceInfant: 0,
      }),
    },
    $transaction: vi.fn().mockImplementation((callback: (tx: typeof mocks.tx) => Promise<unknown>) =>
      callback(mocks.tx)
    ),
  },
}));

// seatLock mock (reserveSeats는 순수 DB 호출, 테스트에서 우회)
vi.mock("../seatLock", () => ({
  reserveSeats: vi.fn().mockResolvedValue(undefined),
  releaseSeats: vi.fn().mockResolvedValue(undefined),
  InsufficientCapacityError: class extends Error {},
}));

// email-job enqueue mock
vi.mock("@/shared/lib/email-job/enqueue", () => ({
  enqueueEmailJob: vi.fn(),
}));

import { createBooking } from "../mutations";
import { decrypt, isEncrypted } from "@/shared/lib/crypto";

// 테스트용 공통 input builder
// CreateBooking input 타입상 passportNo는 string | undefined (Zod .optional(), .nullable() 아님).
// "미입력"의 정형 표현은 undefined(생략된 optional 필드)다.
function makeInput(passportNo?: string) {
  return {
    departureId: "cldev00000000000001",
    userId: "cluse00000000000001",
    adultCount: 1,
    childCount: 0,
    infantCount: 0,
    expectedTotalPrice: 1_000_000,
    travelers: [
      {
        lastNameEn: "KIM",
        firstNameEn: "MINHO",
        gender: "MALE" as const,
        birthDate: new Date("1990-05-15"),
        passportNo,
      },
    ],
    termKeys: ["term-privacy", "term-usage"],
  };
}

describe("createBooking — passportNo 암호화", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // booking.create가 booking 객체를 반환하도록 기본 모킹
    mocks.tx.booking.create.mockResolvedValue({ id: "clbk00000000000001" });
    mocks.tx.bookingEvent.create.mockResolvedValue({});
  });

  it("passportNo가 있을 때 — 저장되는 값이 암호화되어 있어야 한다 (isEncrypted=true)", async () => {
    const originalPassportNo = "M12345678";
    await createBooking(makeInput(originalPassportNo));

    expect(mocks.tx.booking.create).toHaveBeenCalledOnce();
    const callArg = mocks.tx.booking.create.mock.calls[0][0] as {
      data: { travelers: { create: Array<{ passportNo?: string }> } };
    };
    const storedPassportNo = callArg.data.travelers.create[0].passportNo;

    // 저장값이 암호화된 형태여야 한다
    expect(storedPassportNo).toBeDefined();
    expect(isEncrypted(storedPassportNo!)).toBe(true);
    // 복호화 시 원문이 복원되어야 한다
    expect(decrypt(storedPassportNo!)).toBe(originalPassportNo);
  });

  it("passportNo가 미입력(undefined)일 때 — undefined 그대로 유지 (enc:v1: wrapper 없음)", async () => {
    // optional 필드를 생략한 traveler. 미입력의 정형 표현은 undefined다 (타입상 null 불가).
    await createBooking(makeInput(undefined));

    expect(mocks.tx.booking.create).toHaveBeenCalledOnce();
    const callArg = mocks.tx.booking.create.mock.calls[0][0] as {
      data: { travelers: { create: Array<{ passportNo?: string }> } };
    };
    const storedPassportNo = callArg.data.travelers.create[0].passportNo;

    // 미입력이면 nullish 그대로여야 한다 (암호화 대상 아님)
    expect(storedPassportNo == null).toBe(true);
    // 절대 암호화된 형태(enc:v1: wrapper)가 아니어야 한다
    expect(storedPassportNo?.startsWith("enc:v1:")).not.toBe(true);
    if (storedPassportNo != null) {
      expect(isEncrypted(storedPassportNo)).toBe(false);
    }
  });
});
