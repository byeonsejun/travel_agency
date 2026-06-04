import { z } from "zod";
import { productSchema } from "@/entities/product";

/**
 * admin-product Zod schema — entities/product의 productSchema를 재사용.
 *
 * - productInputSchema: create 입력 (productId 없음)
 * - updateProductInputSchema: update 입력 (productId 필수)
 * - productIdSchema: publish/archive 단건 ID 입력
 */

// create 입력은 entities/product의 productSchema와 동일 (status 포함)
export const productInputSchema = productSchema;
export type ProductInput = z.infer<typeof productInputSchema>;

// update 입력은 productId(cuid)를 추가
export const updateProductInputSchema = productSchema.extend({
  productId: z.string().cuid("올바른 상품 ID를 입력하세요"),
});
export type UpdateProductInput = z.infer<typeof updateProductInputSchema>;

// publish/archive는 productId 단건만 받음
export const productIdSchema = z.object({
  productId: z.string().cuid("올바른 상품 ID를 입력하세요"),
});
export type ProductIdInput = z.infer<typeof productIdSchema>;
