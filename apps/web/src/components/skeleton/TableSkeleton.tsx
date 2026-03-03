import { Skeleton } from './Skeleton';

type TableSkeletonProps = {
  rows?: number;
  columns?: number;
  className?: string;
};

export function TableSkeleton({ rows = 6, columns = 5, className = '' }: TableSkeletonProps) {
  return (
    <div className={`panel overflow-hidden p-0 ${className}`} aria-hidden="true">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              {Array.from({ length: columns }).map((_, index) => (
                <th key={`table-head-${index}`} className="px-3 py-3 text-left">
                  <Skeleton className="h-3 w-20" rounded="full" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, rowIndex) => (
              <tr key={`table-row-${rowIndex}`} className="border-b border-slate-100">
                {Array.from({ length: columns }).map((_, colIndex) => (
                  <td key={`table-cell-${rowIndex}-${colIndex}`} className="px-3 py-3">
                    <Skeleton className={colIndex === 0 ? 'h-4 w-36' : 'h-4 w-24'} rounded="sm" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
