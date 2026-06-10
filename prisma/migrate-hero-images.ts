/**
 * (일회성, 멱등) Unsplash 원본 → Supabase 재호스팅 + Product.heroImageUrl 갱신.
 * 실행: 업로드용 env(.env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *       + 갱신 대상 DATABASE_URL(로컬 또는 운영).
 * 안전: DATABASE_URL 빈값이면 중단. 항목별 try/catch 로 부분 실패 격리.
 */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import {
  REVIEW_PHOTO_BUCKET,
  HERO_SEED_PREFIX,
  buildHeroSeedPublicUrl,
} from "../src/shared/lib/supabase/photoMime";
import { HERO_IMAGE_SOURCES } from "./heroImageSources";

const db = new PrismaClient();

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요");
  return createClient(url, key);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("⛔ DATABASE_URL 비어있음");
  const supa = supabaseAdmin();
  let uploaded = 0, updated = 0, failed = 0;

  for (const [slug, srcUrl] of Object.entries(HERO_IMAGE_SOURCES)) {
    try {
      const res = await fetch(srcUrl);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      const path = `${HERO_SEED_PREFIX}/${slug}.jpg`;
      const { error: upErr } = await supa.storage
        .from(REVIEW_PHOTO_BUCKET)
        .upload(path, buf, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      uploaded++;

      const publicUrl = buildHeroSeedPublicUrl(slug);
      const r = await db.product.updateMany({
        where: { heroImageUrl: { contains: `/seed/${slug}/` } },
        data: { heroImageUrl: publicUrl },
      });
      if (r.count === 0) console.warn(`  ⚠️ ${slug}: 매칭 상품 0 (이미 교체됐거나 슬러그 불일치)`);
      updated += r.count;
      console.log(`  ✓ ${slug} (uploaded, updated ${r.count})`);
    } catch (e) {
      failed++;
      console.error(`  ✗ ${slug}: ${(e as Error).message}`);
    }
  }
  console.log(`\n업로드 ${uploaded} / heroImageUrl 갱신 ${updated} / 실패 ${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
