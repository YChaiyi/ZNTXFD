type ContributorListProps = {
  contributors: string[];
};

export function ContributorList({ contributors }: ContributorListProps) {
  if (contributors.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
      {contributors.map((contributor) => (
        <span key={contributor} className="inline-flex items-center gap-1.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background-hover text-[10px] font-semibold text-accent">
            {contributor.slice(0, 1)}
          </span>
          <span>{contributor}</span>
        </span>
      ))}
    </div>
  );
}
