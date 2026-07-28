type TagBadgeProps = {
  children: string;
  className?: string;
};

export function TagBadge({ children, className = "" }: TagBadgeProps) {
  return (
    <span
      className={`tag-pill px-2.5 py-1 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}
