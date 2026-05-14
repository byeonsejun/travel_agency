export class ForbiddenError extends Error {
  constructor(message = "접근 권한이 없습니다") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class PriceMismatchError extends Error {
  constructor(actual: number, expected: number) {
    super(`가격 불일치: 서버 계산값 ${actual}원, 클라이언트 요청값 ${expected}원`);
    this.name = "PriceMismatchError";
  }
}
