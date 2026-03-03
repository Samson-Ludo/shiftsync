import { ReactNode } from 'react';
import { Skeleton } from './Skeleton';
import { SidebarSkeleton } from './SidebarSkeleton';

type PageSkeletonProps = {
  withLayout?: boolean;
  showSidebar?: boolean;
  showTitle?: boolean;
  showSubtitle?: boolean;
  showToolbar?: boolean;
  sectionCount?: number;
  content?: ReactNode;
};

const SkeletonContent = ({
  showTitle,
  showSubtitle,
  showToolbar,
  sectionCount,
  content,
}: Omit<PageSkeletonProps, 'withLayout' | 'showSidebar'>) => (
  <div className="space-y-4" aria-busy="true">
    <span className="sr-only">Loading...</span>

    {(showTitle || showSubtitle) && (
      <section className="space-y-2" aria-hidden="true">
        {showTitle ? <Skeleton className="h-7 w-52" /> : null}
        {showSubtitle ? <Skeleton className="h-4 w-80" rounded="full" /> : null}
      </section>
    )}

    {showToolbar ? (
      <section className="panel p-5" aria-hidden="true">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </section>
    ) : null}

    {content ? (
      content
    ) : (
      <div className="space-y-4" aria-hidden="true">
        {Array.from({ length: sectionCount ?? 2 }).map((_, index) => (
          <section key={`page-skeleton-section-${index}`} className="panel p-5">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="mt-3 h-4 w-full" rounded="sm" />
            <Skeleton className="mt-2 h-4 w-5/6" rounded="sm" />
            <Skeleton className="mt-2 h-4 w-3/4" rounded="sm" />
          </section>
        ))}
      </div>
    )}
  </div>
);

export function PageSkeleton({
  withLayout = false,
  showSidebar = true,
  showTitle = true,
  showSubtitle = true,
  showToolbar = false,
  sectionCount = 2,
  content,
}: PageSkeletonProps) {
  const sharedProps = {
    showTitle,
    showSubtitle,
    showToolbar,
    sectionCount,
    content,
  };

  if (!withLayout) {
    return <SkeletonContent {...sharedProps} />;
  }

  return (
    <div className="min-h-screen bg-slate-50/70" aria-busy="true">
      <span className="sr-only">Loading...</span>
      <div className="mx-auto flex min-h-screen w-full max-w-[1700px]">
        {showSidebar ? <SidebarSkeleton /> : null}

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 shadow-sm backdrop-blur" aria-hidden="true">
            <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 md:hidden" rounded="sm" />
                <div className="space-y-1">
                  <Skeleton className="h-3 w-20" rounded="full" />
                  <Skeleton className="h-5 w-44" />
                </div>
              </div>
              <div className="space-y-1 text-right">
                <Skeleton className="h-4 w-24" rounded="sm" />
                <Skeleton className="ml-auto h-3 w-16" rounded="full" />
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
              <SkeletonContent {...sharedProps} />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
