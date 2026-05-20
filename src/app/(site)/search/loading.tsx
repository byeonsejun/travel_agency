export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <section className="mb-8">
        <div className="mb-6 h-9 w-32 animate-pulse rounded bg-gray-200" />
        <div className="flex gap-2">
          <div className="h-12 flex-1 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-12 w-20 animate-pulse rounded-lg bg-gray-200" />
        </div>
      </section>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse overflow-hidden rounded-lg border border-gray-200"
          >
            <div className="h-48 bg-gray-200" />
            <div className="space-y-3 p-4">
              <div className="h-3 w-1/3 rounded bg-gray-200" />
              <div className="h-4 w-3/4 rounded bg-gray-200" />
              <div className="h-3 w-1/2 rounded bg-gray-200" />
              <div className="flex gap-2">
                <div className="h-5 w-16 rounded-full bg-gray-200" />
                <div className="h-5 w-12 rounded-full bg-gray-200" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
