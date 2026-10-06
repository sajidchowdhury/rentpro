"use client";

import { useMemo, useState } from "react";

/**
 * Client-side pagination hook. The data layer loads everything into memory
 * (from the dump), so we paginate on the client — same UX as DB pagination.
 *
 * `currentPage` is always clamped to a valid page, and the prev/next
 * handlers clamp too — so display + disabled-states stay correct even when a
 * search filter shrinks the list (no setState-in-effect needed).
 */
export function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  return {
    page: currentPage,
    pageSize,
    totalPages,
    total: items.length,
    pageItems,
    setPage: (p: number) => setPage(Math.min(totalPages, Math.max(1, p))),
    next: () => setPage((p) => Math.min(totalPages, p + 1)),
    prev: () => setPage((p) => Math.max(1, Math.min(totalPages, p - 1))),
  };
}
