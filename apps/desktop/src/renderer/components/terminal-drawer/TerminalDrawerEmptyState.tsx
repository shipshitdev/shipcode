export function TerminalDrawerEmptyState() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="text-sm font-medium text-primary">No issue selected for this project</div>
        <div className="mt-1 text-xs leading-5 text-secondary">
          Terminal output will appear when you select or start an issue in this project.
        </div>
      </div>
    </div>
  );
}
