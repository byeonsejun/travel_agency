import { z } from "zod";

export type ProductListParams = {
  sort: "latest" | "price_asc" | "departure_soon";
  page: number;
  destination?: string;
};

const productListParamsSchema = z
  .object({
    sort: z
      .enum(["latest", "price_asc", "departure_soon"])
      .catch("latest"),
    page: z
      .string()
      .pipe(z.coerce.number())
      .pipe(z.number().int().min(1))
      .catch(1),
    destination: z.string().optional(),
  })
  .strict();

export function parseProductListParams(
  params: Record<string, string | string[] | undefined>
): ProductListParams {
  return productListParamsSchema.parse({
    sort: params.sort,
    page: params.page,
    destination: params.destination,
  });
}
