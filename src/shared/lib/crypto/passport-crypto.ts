// ⚠️ 의도적으로 `import "server-only"` 를 쓰지 않는다 (프로젝트 컨벤션 — db.ts / env.ts 동일).
//  이유 1) `server-only` 는 Next/webpack(빌드) 와 vitest(alias)에서만 해석되는 패키지라,
//          이 모듈을 bare `tsx`(Node)로 실행하는 운영 스크립트(scripts/encrypt-passports.ts)가
//          `Cannot find module 'server-only'` 로 죽는다. db.ts/env.ts 가 server 전용임에도
//          server-only 를 안 붙이는 것과 동일한 이유(스크립트·배럴 호환).
//  이유 2) `import "server-only"` 는 부수효과 전용 import라 트리셰이킹에서 제거되지 않아,
//          fat barrel 을 통해 'use client' 그래프로 끌려가면 빌드를 깬다.
//  클라이언트 누수 차단은 (a) booking 슬라이스의 client-safe 서브배럴(`./client.ts`)로 server
//  코드를 분리, (b) 잘못 import 시 아래 `@/shared/lib/env` 가 브라우저에서 server 전용 env 를
//  parse 하다 ZodError 로 즉시 터지는 트립와이어 — 두 겹으로 유지된다(db.ts/env.ts 와 동형).
//  node:crypto / env 모두 서버 전용이므로 이 모듈은 server 모듈에서만 import 할 것.
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { env } from "@/shared/lib/env";

// 저장 포맷: enc:v1: + base64( iv(12) || authTag(16) || ciphertext )
export const ENC_PREFIX = "enc:v1:";

const ALGORITHM = "aes-256-gcm";
// 테스트(정밀 변조 오프셋 계산)에서 참조하므로 export.
export const IV_LENGTH = 12;     // AES-GCM 권장 96비트
export const TAG_LENGTH = 16;    // GCM auth tag 128비트

/** lazy memoized 키 로더 — 첫 호출 시 env.ENCRYPTION_KEY 검증 */
let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (_cachedKey !== null) return _cachedKey;

  const raw = env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY 환경 변수가 설정되지 않았습니다. " +
      "base64 인코딩된 32바이트 키가 필요합니다."
    );
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY 디코딩 결과가 ${decoded.length}바이트입니다. ` +
      "AES-256은 정확히 32바이트 키가 필요합니다."
    );
  }

  _cachedKey = decoded;
  return _cachedKey;
}

/**
 * 평문을 AES-256-GCM으로 암호화한다.
 * 출력 형식: `enc:v1:` + base64(iv(12) || authTag(16) || ciphertext)
 *
 * 멱등성 가드: 이미 `enc:v1:` 로 시작하는 값이 전달되면 재암호화 없이
 * 그대로 반환한다. 이중 암호화(doubly-encrypted blob)가 생성되면 두 번째
 * decrypt 시 GCM 인증 실패로 throw 되므로, 이 가드가 백필·마이그레이션
 * 경로의 실수에 대한 안전망 역할을 한다.
 */
export function encrypt(plaintext: string): string {
  if (isEncrypted(plaintext)) return plaintext;

  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // iv || authTag || ciphertext 순서로 연결
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return ENC_PREFIX + payload.toString("base64");
}

/**
 * `enc:v1:` prefix가 있으면 AES-256-GCM 복호화 후 원문 반환.
 * prefix가 없으면 (레거시 평문) 그대로 반환한다 (하위 호환 / lazy 마이그레이션).
 */
export function decrypt(value: string): string {
  if (!isEncrypted(value)) {
    // 레거시 평문 — 다음 쓰기 때 자동으로 암호화로 수렴
    return value;
  }

  const key = getKey();
  const payload = Buffer.from(value.slice(ENC_PREFIX.length), "base64");

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/**
 * 저장된 값이 이미 암호화되어 있는지 판별한다.
 * `enc:v1:` prefix의 존재 여부만으로 O(1) 검사.
 */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}
