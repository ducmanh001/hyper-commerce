import Link from 'next/link';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
}

export function Pagination({ currentPage, totalPages, baseUrl }: PaginationProps) {
  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i + 1;
    if (currentPage <= 4) return i + 1;
    if (currentPage >= totalPages - 3) return totalPages - 6 + i;
    return currentPage - 3 + i;
  });

  return (
    <nav className="flex items-center gap-1" aria-label="Pagination">
      {currentPage > 1 && (
        <Link
          href={`${baseUrl}&page=${currentPage - 1}`}
          className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50 transition-colors"
        >
          ←
        </Link>
      )}
      {pages.map((page) => (
        <Link
          key={page}
          href={`${baseUrl}&page=${page}`}
          className={`px-3 py-2 text-sm border rounded-md transition-colors ${
            page === currentPage
              ? 'bg-primary-500 text-white border-primary-500'
              : 'hover:bg-gray-50'
          }`}
        >
          {page}
        </Link>
      ))}
      {currentPage < totalPages && (
        <Link
          href={`${baseUrl}&page=${currentPage + 1}`}
          className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50 transition-colors"
        >
          →
        </Link>
      )}
    </nav>
  );
}
