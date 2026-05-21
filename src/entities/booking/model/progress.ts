import type { BookingStatus } from "@prisma/client";
import {
  BOOKING_PROGRESS_STEPS,
  BOOKING_STATUS_LABEL,
  type BookingProgressStep,
} from "./constants";

export type BookingProgressStepState = "done" | "current" | "upcoming";

export type BookingProgressStepView = {
  key: BookingProgressStep;
  label: string;
  state: BookingProgressStepState;
};

export type BookingProgress = {
  canceled: boolean;
  canceledBy?: "user" | "agency";
  steps: BookingProgressStepView[];
};

const CANCEL_MAP: Partial<Record<BookingStatus, "user" | "agency">> = {
  CANCELED_BY_USER: "user",
  CANCELED_BY_AGENCY: "agency",
};

export function getBookingProgress(status: BookingStatus): BookingProgress {
  const canceledBy = CANCEL_MAP[status];
  if (canceledBy) {
    return {
      canceled: true,
      canceledBy,
      steps: BOOKING_PROGRESS_STEPS.map((key) => ({
        key,
        label: BOOKING_STATUS_LABEL[key],
        state: "upcoming" as const,
      })),
    };
  }

  // 진행 중 상태: 현재 status의 인덱스를 기준으로 done/current/upcoming 결정.
  // COMPLETED는 마지막 단계 → 모두 done.
  const currentIndex = BOOKING_PROGRESS_STEPS.indexOf(
    status as BookingProgressStep,
  );
  const isTerminal = status === "COMPLETED";

  return {
    canceled: false,
    steps: BOOKING_PROGRESS_STEPS.map((key, i) => {
      let state: BookingProgressStepState;
      if (isTerminal) {
        state = "done";
      } else if (i < currentIndex) {
        state = "done";
      } else if (i === currentIndex) {
        state = "current";
      } else {
        state = "upcoming";
      }
      return { key, label: BOOKING_STATUS_LABEL[key], state };
    }),
  };
}
