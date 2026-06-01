import type { EmbeddingJobStatus, ProductStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";
import type { ProductDetail } from "../model/types";

export const ADMIN_PAGE_SIZE = 20;

export type AdminProductRow = {
  id: string;
  title: string;
  destination: string;
  status: ProductStatus;
  basePriceAdult: number;
  createdAt: Date;
  updatedAt: Date;
  latestJob: {
    status: EmbeddingJobStatus;
    attempts: number;
    updatedAt: Date;
    lastError: string | null;
  } | null;
};

export type AdminEmbeddingInfo = {
  contentHash: string | null;
  modelVersion: string;
  updatedAt: Date;
};

export type AdminLatestJobInfo = {
  id: string;
  status: EmbeddingJobStatus;
  attempts: number;
  lastError: string | null;
  contentHash: string | null;
  nextRunAt: Date;
  updatedAt: Date;
};

export type AdminProductDetailResult = {
  product: ProductDetail;
  embedding: AdminEmbeddingInfo | null;
  latestJob: AdminLatestJobInfo | null;
};

// 🔐 Admin-only — force-dynamic 페이지 전용 (캐시 없음)
export async function listAdminProducts(params: {
  status?: ProductStatus;
  page?: number;
}): Promise<{ items: AdminProductRow[]; total: number }> {
  const page = Math.max(params.page ?? 1, 1);
  const where = params.status ? { status: params.status } : {};

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: ADMIN_PAGE_SIZE,
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        destination: true,
        status: true,
        basePriceAdult: true,
        createdAt: true,
        updatedAt: true,
        embeddingJobs: {
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { status: true, attempts: true, updatedAt: true, lastError: true },
        },
      },
    }),
    db.product.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      latestJob: row.embeddingJobs[0] ?? null,
    })),
    total,
  };
}

// 🔐 Admin-only — status 무관 전체 조회 (getProductById 는 PUBLISHED만 반환)
export async function getAdminProductById(
  id: string
): Promise<AdminProductDetailResult | null> {
  const raw = await db.product.findUnique({
    where: { id },
    include: {
      tags: true,
      inclusions: true,
      itineraryDays: {
        include: { stops: { orderBy: { order: "asc" } } },
        orderBy: { dayNumber: "asc" },
      },
      embedding: {
        select: { contentHash: true, modelVersion: true, updatedAt: true },
      },
      embeddingJobs: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          attempts: true,
          lastError: true,
          contentHash: true,
          nextRunAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!raw) return null;

  const { embedding, embeddingJobs, ...product } = raw;

  return {
    product: product as ProductDetail,
    embedding: embedding ?? null,
    latestJob: embeddingJobs[0] ?? null,
  };
}
