import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("skeleton-premium rounded-md", className)}
      {...props}
    />
  );
}

export function MatchSkeleton() {
  return (
    <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] mb-3">
      <div className="flex justify-between items-center mb-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="flex justify-between items-center px-8">
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-8" />
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    </div>
  );
}
export function DisciplineCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-[2rem] bg-white border border-slate-200 shadow-sm">
      <div className="relative h-48 w-full bg-slate-100 overflow-hidden">
        <Skeleton className="h-full w-full bg-slate-200" />
        <div className="absolute bottom-6 left-8 flex items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-xl bg-white shadow-lg" />
          <Skeleton className="h-10 w-48 bg-white/50" />
        </div>
      </div>
      <div className="p-8 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl bg-slate-50" />
          ))}
        </div>
        <div className="mt-8 flex gap-3">
          <Skeleton className="h-12 flex-1 rounded-xl bg-slate-50" />
          <Skeleton className="h-12 flex-1 rounded-xl bg-indigo-50" />
        </div>
      </div>
    </div>
  );
}

export function TournamentSkeleton() {
  return (
    <div className="flex items-center justify-between p-4 rounded-2xl border border-white/5 bg-white/[0.02] animate-pulse">
      <div className="flex items-center gap-4">
        <Skeleton className="h-12 w-12 rounded-xl bg-white/10" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-48 bg-white/10" />
          <div className="flex gap-2">
            <Skeleton className="h-4 w-24 bg-white/5" />
            <Skeleton className="h-4 w-12 bg-white/5" />
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <Skeleton className="h-8 w-28 rounded-lg bg-white/10" />
        <Skeleton className="h-4 w-16 bg-white/5" />
      </div>
    </div>
  );
}
