export class PaymentError extends Error {
  readonly name = "PaymentError";

  constructor(
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(`PaymentError: ${code}`);
  }
}

export class InvalidSignatureError extends Error {
  readonly name = "InvalidSignatureError";

  constructor(message = "Invalid Toss webhook signature") {
    super(message);
  }
}
