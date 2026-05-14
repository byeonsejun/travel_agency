import { env } from "@/shared/lib/env";
import { PaymentError } from "./errors";
import type { TossConfirmResponse, TossCancelResponse } from "./types";

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${env.TOSS_SECRET_KEY ?? ""}:`).toString("base64")}`;
}

function assertInteger(amount: number, field = "amount"): void {
  if (!Number.isInteger(amount)) {
    throw new PaymentError("AMOUNT_NOT_INTEGER", { [field]: amount });
  }
}

async function tossRequest<T>(
  url: string,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuthHeader(),
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    throw new PaymentError("PG_NETWORK_ERROR", { url, cause: String(err) });
  }

  if (!res.ok) {
    let responseBody: unknown = null;
    try {
      responseBody = await res.json();
    } catch {
      /* ignore parse error */
    }
    throw new PaymentError("PG_HTTP", { status: res.status, body: responseBody });
  }

  return res.json() as Promise<T>;
}

export const tossClient = {
  confirm({
    paymentKey,
    orderId,
    amount,
  }: {
    paymentKey: string;
    orderId: string;
    amount: number;
  }): Promise<TossConfirmResponse> {
    assertInteger(amount);
    return tossRequest<TossConfirmResponse>(
      `${env.TOSS_API_BASE_URL}/v1/payments/confirm`,
      { paymentKey, orderId, amount },
      `confirm:${paymentKey}`
    );
  },

  cancel({
    paymentKey,
    cancelReason,
    cancelAmount,
  }: {
    paymentKey: string;
    cancelReason: string;
    cancelAmount: number;
  }): Promise<TossCancelResponse> {
    assertInteger(cancelAmount, "cancelAmount");
    return tossRequest<TossCancelResponse>(
      `${env.TOSS_API_BASE_URL}/v1/payments/${paymentKey}/cancel`,
      { cancelReason, cancelAmount },
      `cancel:${paymentKey}`
    );
  },
};
