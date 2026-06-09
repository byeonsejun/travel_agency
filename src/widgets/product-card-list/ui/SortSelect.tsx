"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { nextSortUrl } from "../model/sortUrl";

type SortSelectProps = {
  current: string;
};

const SORT_OPTIONS = [
  { value: "latest", label: "최신순" },
  { value: "price_asc", label: "최저가" },
  { value: "departure_soon", label: "출발임박" },
];

export function SortSelect({ current }: SortSelectProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleSortChange = (value: string) => {
    // 네비게이션을 transition 으로 감싸 isPending 으로 펜딩 시각 처리.
    // useTransition 은 타이머/리스너 없음 → cleanup 불필요 (ADR-0035 역할분담).
    startTransition(() => {
      router.push(nextSortUrl(params, value));
    });
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      <Select value={current} onValueChange={handleSortChange} disabled={isPending}>
        <SelectTrigger className="w-40" aria-busy={isPending}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isPending && (
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-primary" />
      )}
    </div>
  );
}
