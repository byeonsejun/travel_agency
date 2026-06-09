export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border bg-secondary py-10 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-5 px-6">
        <div>
          <b className="text-base text-foreground">Nextour</b>
          <p className="mt-1">AI 기반 맞춤형 패키지 여행 플랫폼</p>
        </div>
        <div className="md:text-right">
          <p>회사소개 · 이용약관 · 개인정보처리방침</p>
          <p className="mt-1">고객센터 1234-5678</p>
        </div>
      </div>
    </footer>
  );
}
