// enforce.ts stub — Task 5 will add the enforce() function
export interface RateLimitVerdict {
  readonly ok: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
  readonly retryAfterSeconds: number;
  readonly shadowed: boolean;
  readonly bypassed: boolean;
}
