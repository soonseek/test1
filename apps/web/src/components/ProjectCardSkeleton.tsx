export default function ProjectCardSkeleton() {
  return (
    <div className="glass-card rounded-2xl p-6 h-full">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between mb-4">
        <div className="skeleton h-6 w-24 rounded-full" />
        <div className="skeleton h-4 w-16 rounded" />
      </div>

      {/* Title Skeleton */}
      <div className="skeleton h-7 w-3/4 rounded mb-2" />
      
      {/* Description Skeleton */}
      <div className="space-y-2 mb-4">
        <div className="skeleton h-4 w-full rounded" />
        <div className="skeleton h-4 w-5/6 rounded" />
      </div>

      {/* Stats Skeleton */}
      <div className="flex items-center gap-3 mb-4">
        <div className="skeleton h-8 w-20 rounded-lg" />
        <div className="skeleton h-8 w-20 rounded-lg" />
      </div>

      {/* Deployment Info Skeleton */}
      <div className="space-y-2 pt-3 border-t border-vivid-purple/10">
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-4/5 rounded" />
      </div>
    </div>
  );
}