import { z } from "zod";
import { ProductStatus, InclusionKind } from "@prisma/client";

export const itineraryStopSchema = z.object({
  order: z.number().int().min(0),
  time: z.string().optional(),
  place: z.string().min(1, "방문지를 입력하세요"),
  description: z.string().optional(),
});

export const itineraryDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  title: z.string().min(1, "일정 제목을 입력하세요"),
  accommodation: z.string().optional(),
  meals: z.object({
    breakfast: z.string().optional(),
    lunch: z.string().optional(),
    dinner: z.string().optional(),
  }),
  stops: z.array(itineraryStopSchema),
});

export const inclusionSchema = z.object({
  kind: z.nativeEnum(InclusionKind),
  label: z.string().min(1, "항목명을 입력하세요"),
  note: z.string().optional(),
});

export const productSchema = z.object({
  title: z.string().min(2, "상품명은 2자 이상이어야 합니다"),
  summary: z.string().min(10, "요약은 10자 이상이어야 합니다"),
  destination: z.string().min(1, "목적지를 입력하세요"),
  destinationCode: z.string().optional(),
  durationNights: z.number().int().min(1),
  durationDays: z.number().int().min(1),
  heroImageUrl: z.string().url("올바른 URL을 입력하세요").optional(),
  basePriceAdult: z.number().int().min(0),
  status: z.nativeEnum(ProductStatus).default("DRAFT"),
  tags: z.array(z.string()).min(1, "태그를 1개 이상 입력하세요"),
  inclusions: z.array(inclusionSchema),
  itineraryDays: z.array(itineraryDaySchema).min(1, "일정을 1일 이상 입력하세요"),
});

export type ProductFormData = z.infer<typeof productSchema>;
