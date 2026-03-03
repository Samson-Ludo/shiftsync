import { Skeleton } from './Skeleton';

export function SidebarSkeleton() {
  return (
    <div className="hidden md:block md:w-72 md:flex-none" aria-hidden="true">
      <aside className="sticky top-0 h-screen border-r border-slate-200 bg-white/90 shadow-sm backdrop-blur">
        <div className="flex h-full flex-col px-4 py-4">
          <div className="border-b border-slate-200 pb-4">
            <Skeleton className="h-3 w-16" rounded="full" />
            <Skeleton className="mt-2 h-6 w-28" />
            <Skeleton className="mt-2 h-3 w-24" rounded="full" />
          </div>

          <div className="mt-5 flex-1 space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`nav-skeleton-${index}`} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
                <Skeleton className="h-4 w-4" rounded="sm" />
                <Skeleton className="h-4 w-28" rounded="sm" />
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-slate-200 pt-4">
            <Skeleton className="h-4 w-32" rounded="sm" />
            <Skeleton className="mt-2 h-3 w-40" rounded="full" />
            <Skeleton className="mt-3 h-10 w-full" />
          </div>
        </div>
      </aside>
    </div>
  );
}
