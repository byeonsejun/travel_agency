import { z } from "zod";
import { productSchema } from "@/entities/product";

/**
 * admin-product Zod schema — entities/product의 productSchema를 재사용.
 *
 * - productInputSchema: create 입력 (productId 없음)
 * - updateProductInputSchema: update 입력 (productId 필수)
 * - productIdSchema: publish/archive 단건 ID 입력
 */

// 위약금 정책 key (Phase 14) — "" / 미지정은 null(시스템 기본 폴백)로 정규화.
// optional 로 두어 기존 입력(미지정)도 하위호환.
const penaltyPolicyKeyField = z
  .preprocess(
    (v) => (v === "" || v == null ? null : v),
    z.string().min(1).nullable(),
  )
  .optional();

// create 입력은 productSchema + 위약금 정책 key
const productWithPolicySchema = productSchema.extend({
  penaltyPolicyKey: penaltyPolicyKeyField,
});

export const productInputSchema = productWithPolicySchema;
export type ProductInput = z.infer<typeof productInputSchema>;

// update 입력은 productId(cuid)를 추가
export const updateProductInputSchema = productWithPolicySchema.extend({
  productId: z.string().cuid("올바른 상품 ID를 입력하세요"),
});
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

// publish/archive는 productId 단건만 받음
export const productIdSchema = z.object({
  productId: z.string().cuid("올바른 상품 ID를 입력하세요"),
});
export type ProductIdInput = z.infer<typeof productIdSchema>;
