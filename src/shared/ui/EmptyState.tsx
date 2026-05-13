type EmptyStateProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {description && (
        <p className="text-sm text-gray-600 max-w-sm text-center">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
