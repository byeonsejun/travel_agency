import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JsonLd } from "@/shared/ui/JsonLd";

function body(html: string): string {
  return html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
}

describe("JsonLd", () => {
  it("본문에 </script> 가 들어 있어도 스크립트를 닫지 않는다", () => {
    const html = renderToStaticMarkup(<JsonLd data={{ name: "a</script><b>" }} />);
    expect(html.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(html.split("</script>").length - 1).toBe(1);
    expect(html.endsWith("</script>")).toBe(true);
    expect(JSON.parse(body(html))).toEqual({ name: "a</script><b>" });
  });

  it("배열을 그대로 직렬화한다", () => {
    const data = [{ "@type": "A" }, { "@type": "B" }];
    const html = renderToStaticMarkup(<JsonLd data={data} />);
    expect(JSON.parse(body(html))).toEqual(data);
  });
});
