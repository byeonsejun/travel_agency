// vitest용 server-only no-op 스텁.
// Next.js의 `import "server-only"`는 클라이언트 번들 침투를 빌드 단계에서 차단한다.
// vitest(Node.js 환경)에서는 이 guard가 불필요하므로 빈 모듈로 대체.
// vitest.config.ts resolve.alias에서 "server-only" → 이 파일로 aliasing.
export {};
