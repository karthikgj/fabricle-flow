import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationProps = {
  totalItems: number;
  currentPage: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  itemLabel?: string;
};

/** Shared compact pagination footer used by all record-list screens. */
export default function Pagination({
  totalItems,
  currentPage,
  pageSize = 10,
  onPageChange,
  loading = false,
  itemLabel = "items",
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(1, currentPage), totalPages);
  const first = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, totalItems);
  const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (value) => value === 1 || value === totalPages || Math.abs(value - page) <= 1,
  );

  return (
    <nav className="ff-pagination" aria-label="Table pagination">
      <p className="ff-pagination-summary">
        Showing <strong>{first}–{last}</strong> of <strong>{totalItems.toLocaleString()}</strong> {itemLabel}
      </p>
      <div className="ff-pagination-actions">
        <button type="button" className="ff-pagination-arrow" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft size={17} />
        </button>
        {pages.map((value, index) => (
          <span className="ff-pagination-page-wrap" key={value}>
            {index > 0 && value - pages[index - 1] > 1 && <span className="ff-pagination-ellipsis">…</span>}
            <button type="button" className={`ff-pagination-page${value === page ? " is-active" : ""}`} aria-current={value === page ? "page" : undefined} disabled={loading} onClick={() => onPageChange(value)}>{value}</button>
          </span>
        ))}
        <button type="button" className="ff-pagination-arrow" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>
          <ChevronRight size={17} />
        </button>
      </div>
    </nav>
  );
}
