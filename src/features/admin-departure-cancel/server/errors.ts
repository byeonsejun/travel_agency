// 오케스트레이션 도메인 에러. "use server" 파일은 async 함수만 export 가능하므로
// 에러 클래스(런타임 값)는 이 비-"use server" 모듈에 분리한다.

export class DepartureNotCancelableError extends Error {
  constructor(public readonly departureId: string) {
    super(`Departure ${departureId} is not cancelable (already canceled or missing)`);
    this.name = "DepartureNotCancelableError";
  }
}

export class RefundablePaymentMissingError extends Error {
  constructor(public readonly bookingId: string) {
    super(`PAID/READY booking ${bookingId} has no PAID payment row`);
    this.name = "RefundablePaymentMissingError";
  }
}
