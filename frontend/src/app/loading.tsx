import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh] animate-in">
       <div className="flex flex-col items-center gap-6 text-center">
          <div className="relative h-16 w-16">
             <div className="absolute inset-0 rounded-full border-4 border-indigo-100" />
             <div className="absolute inset-0 rounded-full border-4 border-t-indigo-600 animate-spin" />
          </div>
          <div className="space-y-2">
             <Skeleton className="h-6 w-32 bg-slate-100 mx-auto" />
             <Skeleton className="h-4 w-48 bg-slate-50 mx-auto" />
          </div>
       </div>
    </div>
  );
}
