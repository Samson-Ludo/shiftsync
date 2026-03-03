import { HTMLAttributes } from 'react';

type SkeletonProps = {
  className?: string;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  'aria-label'?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'className' | 'aria-label'>;

const roundedClassMap: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

export function Skeleton({ className = '', rounded = 'md', 'aria-label': ariaLabel, ...rest }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      aria-label={ariaLabel}
      className={`animate-pulse bg-slate-200/80 ${roundedClassMap[rounded]} ${className}`}
      {...rest}
    />
  );
}
