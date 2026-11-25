interface JsonLdProps {
  data: Record<string, unknown> | Record<string, unknown>[];
}

// 구조화 데이터를 서버에서 HTML 에 직접 넣는다. `<` 를 이스케이프해
// 값에 `</script>` 가 들어 있어도 스크립트가 닫히지 않게 한다.
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
