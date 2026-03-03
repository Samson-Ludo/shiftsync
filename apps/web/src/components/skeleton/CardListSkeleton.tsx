import { Skeleton } from './Skeleton';

type CardListSkeletonProps = {
  count?: number;
  showBadge?: boolean;
  className?: string;
};

export function CardListSkeleton({ count = 4, showBadge = true, className = '' }: CardListSkeletonProps) {
  return (
    <ul className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <li key={`card-skeleton-${index}`} className="rounded-xl border border-slate-200 bg-white/85 p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-5 w-48" />
            {showBadge ? <Skeleton className="h-6 w-20" rounded="full" /> : null}
          </div>
          <Skeleton className="mt-3 h-4 w-64" rounded="sm" />
          <Skeleton className="mt-2 h-3 w-52" rounded="full" />
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-24" />
          </div>
        </li>
      ))}
    </ul>
  );
}
