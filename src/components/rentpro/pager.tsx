"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Compact pager: showing X–Y of Z · ‹ Page n of m ›. Hidden when 1 page. */
export function Pager({
  page, totalPages, total, pageSize, onPrev, onNext,
}: {
  page: number; totalPages: number; total: number; pageSize: number;
  onPrev: () => void; onNext: () => void;
}) {
  if (total <= pageSize) return null;
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-xs text-muted-foreground">
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" className="size-7 p-0" onClick={onPrev} disabled={page <= 1} title="Previous page">
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="tabular-nums px-1">Page {page} of {totalPages}</span>
        <Button size="sm" variant="outline" className="size-7 p-0" onClick={onNext} disabled={page >= totalPages} title="Next page">
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
