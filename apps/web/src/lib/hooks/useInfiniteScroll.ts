'use client';

import { useEffect, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions {
  onLoadMore:  () => void;
  hasMore:     boolean;
  loading:     boolean;
  rootMargin?: string;
  threshold?:  number;
}

/**
 * Returns a ref to attach to the sentinel element at the bottom of a list.
 * Calls `onLoadMore` when the sentinel enters the viewport.
 */
export function useInfiniteScroll({
  onLoadMore,
  hasMore,
  loading,
  rootMargin = '200px',
  threshold  = 0,
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && hasMore && !loading) {
        onLoadMore();
      }
    },
    [hasMore, loading, onLoadMore],
  );

  useEffect(() => {
    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(handleIntersect, {
      rootMargin,
      threshold,
    });
    if (sentinelRef.current) {
      observerRef.current.observe(sentinelRef.current);
    }
    return () => observerRef.current?.disconnect();
  }, [handleIntersect, rootMargin, threshold]);

  return sentinelRef;
}
