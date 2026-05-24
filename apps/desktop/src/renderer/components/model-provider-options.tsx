export function InheritValueDisplay({ detail }: { detail: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 truncate">
      <span className="text-muted-foreground">Inherit</span>
      <span className="text-muted-foreground">·</span>
      <span className="truncate text-primary">{detail}</span>
    </span>
  );
}
