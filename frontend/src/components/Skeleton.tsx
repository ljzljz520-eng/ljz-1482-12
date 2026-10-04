const Skeleton = ({ className = "h-4" }: { className?: string }) => (
  <div className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`} />
);

export default Skeleton;
