"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProductOption } from "@/entities/analytics";

export function ProductSelect({
  options,
  current,
}: {
  options: ProductOption[];
  current: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = new URLSearchParams(params.toString());
    const value = e.target.value;
    if (value === "all") next.delete("productId");
    else next.set("productId", value);
    startTransition(() => {
      router.push(`/admin/dashboard?${next.toString()}`);
    });
  };

  return (
    <div className="relative inline-flex items-center">
      <select
        value={current ?? "all"}
        onChange={handleChange}
        disabled={isPending}
        aria-busy={isPending}
        className={`rounded-lg border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-foreground hover:border-muted-foreground focus:border-primary focus:outline-none ${
          isPending ? "opacity-50" : ""
        }`}
      >
        <option value="all">전체 상품</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
          </option>
        ))}
      </select>
      {isPending && (
        <span
          aria-hidden="true"
          className="absolute right-2 h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-primary"
        />
      )}
    </div>
  );
}
