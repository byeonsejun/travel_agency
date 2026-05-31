export {
  createProductAction,
  updateProductAction,
  publishProductAction,
  archiveProductAction,
} from "./server/actions";
export type {
  CreateProductState,
  UpdateProductState,
  PublishProductState,
  ArchiveProductState,
} from "./server/actions";

export {
  productInputSchema,
  updateProductInputSchema,
  productIdSchema,
} from "./model/schemas";
export type {
  ProductInput,
  UpdateProductInput,
  ProductIdInput,
} from "./model/schemas";
