interface SkeletonProps {
  className?: string;
  rounded?:   boolean;
  circle?:    boolean;
}

export function Skeleton({ className = '', rounded, circle }: SkeletonProps) {
  const base = 'animate-pulse bg-gray-200';
  const shape = circle ? 'rounded-full' : rounded ? 'rounded-lg' : 'rounded';
  return <div className={`${base} ${shape} ${className}`} aria-hidden="true" />;
}

export function ProductCardSkeleton() {
  return (
    <div className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100">
      <Skeleton className="h-48 w-full" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4" rounded />
        <Skeleton className="h-3 w-1/2" rounded />
        <Skeleton className="h-5 w-2/5" rounded />
      </div>
    </div>
  );
}

export function OrderCardSkeleton() {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-32" rounded />
        <Skeleton className="h-4 w-20" rounded />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-16 w-16 flex-shrink-0" rounded />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" rounded />
          <Skeleton className="h-4 w-3/4" rounded />
        </div>
      </div>
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-4 w-full" rounded />
        </td>
      ))}
    </tr>
  );
}
