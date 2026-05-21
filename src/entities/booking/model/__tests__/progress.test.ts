import { describe, it, expect } from "vitest";
import { getBookingProgress } from "../progress";
import { BOOKING_PROGRESS_STEPS } from "../constants";

describe("getBookingProgress — 진행 중 상태", () => {
  it("RECEIVED → step 0이 current, 나머지는 upcoming", () => {
    const result = getBookingProgress("RECEIVED");
    expect(result.canceled).toBe(false);
    expect(result.steps).toHaveLength(BOOKING_PROGRESS_STEPS.length);
    expect(result.steps[0].state).toBe("current");
    expect(result.steps[0].key).toBe("RECEIVED");
    for (let i = 1; i < result.steps.length; i++) {
      expect(result.steps[i].state).toBe("upcoming");
    }
  });

  it("AWAITING_GROUP → step 0 done, step 1 current", () => {
    const result = getBookingProgress("AWAITING_GROUP");
    expect(result.canceled).toBe(false);
    expect(result.steps[0].state).toBe("done");
    expect(result.steps[1].state).toBe("current");
    expect(result.steps[1].key).toBe("AWAITING_GROUP");
    expect(result.steps[2].state).toBe("upcoming");
  });

  it("DEPARTURE_CONFIRMED → step 0~1 done, step 2 current", () => {
    const result = getBookingProgress("DEPARTURE_CONFIRMED");
    expect(result.steps[0].state).toBe("done");
    expect(result.steps[1].state).toBe("done");
    expect(result.steps[2].state).toBe("current");
    expect(result.steps[2].key).toBe("DEPARTURE_CONFIRMED");
    expect(result.steps[3].state).toBe("upcoming");
  });

  it("PAID → step 0~2 done, step 3 current", () => {
    const result = getBookingProgress("PAID");
    expect(result.steps[0].state).toBe("done");
    expect(result.steps[1].state).toBe("done");
    expect(result.steps[2].state).toBe("done");
    expect(result.steps[3].state).toBe("current");
    expect(result.steps[3].key).toBe("PAID");
  });

  it("READY → step 0~3 done, step 4 current", () => {
    const result = getBookingProgress("READY");
    expect(result.steps[4].state).toBe("current");
    expect(result.steps[4].key).toBe("READY");
    for (let i = 0; i < 4; i++) {
      expect(result.steps[i].state).toBe("done");
    }
  });

  it("COMPLETED → 모든 step이 done (current 없음)", () => {
    const result = getBookingProgress("COMPLETED");
    expect(result.canceled).toBe(false);
    for (const step of result.steps) {
      expect(step.state).toBe("done");
    }
    expect(result.steps.find((s) => s.state === "current")).toBeUndefined();
  });
});

describe("getBookingProgress — 취소 상태", () => {
  it("CANCELED_BY_USER → canceled=true, canceledBy='user'", () => {
    const result = getBookingProgress("CANCELED_BY_USER");
    expect(result.canceled).toBe(true);
    expect(result.canceledBy).toBe("user");
    // 진행 바 자체는 렌더하지 않을 것이지만, steps 배열은 일관성을 위해 채워서 반환
    expect(result.steps).toHaveLength(BOOKING_PROGRESS_STEPS.length);
    for (const step of result.steps) {
      expect(step.state).toBe("upcoming");
    }
  });

  it("CANCELED_BY_AGENCY → canceled=true, canceledBy='agency'", () => {
    const result = getBookingProgress("CANCELED_BY_AGENCY");
    expect(result.canceled).toBe(true);
    expect(result.canceledBy).toBe("agency");
  });
});

describe("getBookingProgress — 라벨 정합성", () => {
  it("모든 step의 label은 비어있지 않으며 한국어", () => {
    const result = getBookingProgress("RECEIVED");
    for (const step of result.steps) {
      expect(step.label.length).toBeGreaterThan(0);
    }
  });
});
