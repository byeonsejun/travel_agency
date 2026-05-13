import type { Inclusion } from "@prisma/client";

type InclusionListProps = {
  inclusions: Inclusion[];
};

export function InclusionList({ inclusions }: InclusionListProps) {
  const included = inclusions.filter((item) => item.kind === "INCLUDED");
  const excluded = inclusions.filter((item) => item.kind === "EXCLUDED");

  return (
    <div className="space-y-6">
      {/* INCLUDED 섹션 */}
      {included.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold text-gray-900">포함되는 항목</h3>
          <div className="space-y-2">
            {included.map((item) => (
              <div
                key={item.id}
                className="flex gap-3 rounded-lg border border-green-200 bg-green-50 p-3"
              >
                <div className="flex-shrink-0 text-green-600">
                  <svg
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{item.label}</p>
                  {item.note && (
                    <p className="text-sm text-gray-600">{item.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EXCLUDED 섹션 */}
      {excluded.length > 0 && (
        <div>
          <h3 className="mb-3 font-semibold text-gray-900">제외되는 항목</h3>
          <div className="space-y-2">
            {excluded.map((item) => (
              <div
                key={item.id}
                className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3"
              >
                <div className="flex-shrink-0 text-red-600">
                  <svg
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{item.label}</p>
                  {item.note && (
                    <p className="text-sm text-gray-600">{item.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
