import type { ItineraryDay, ItineraryStop } from "@prisma/client";

type ItineraryTimelineProps = {
  days: (ItineraryDay & { stops: ItineraryStop[] })[];
};

export function ItineraryTimeline({ days }: ItineraryTimelineProps) {
  return (
    <div className="space-y-8">
      {days.map((day, index) => {
        const meals = day.meals as Record<string, string> | null;

        return (
          <div key={day.id} className="relative">
            {/* 일차 배지와 제목 */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                {day.dayNumber}
              </div>
              <h3 className="text-lg font-semibold text-gray-900">
                {day.title}
              </h3>
            </div>

            {/* 방문지 목록 */}
            {day.stops.length > 0 && (
              <div className="mb-4 space-y-3 pl-5">
                <p className="text-sm font-medium text-gray-700">
                  방문지
                </p>
                {day.stops.map((stop) => (
                  <div
                    key={stop.id}
                    className="border-l-2 border-gray-300 pl-4"
                  >
                    <div className="flex gap-2">
                      {stop.time && (
                        <span className="text-sm font-medium text-gray-600">
                          {stop.time}
                        </span>
                      )}
                      <span className="font-medium text-gray-900">
                        {stop.place}
                      </span>
                    </div>
                    {stop.description && (
                      <p className="mt-1 text-sm text-gray-600">
                        {stop.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 식사 정보 */}
            {meals && (
              <div className="mb-4 space-y-2 pl-5">
                {[
                  { key: "breakfast", label: "아침" },
                  { key: "lunch", label: "점심" },
                  { key: "dinner", label: "저녁" },
                ].map(({ key, label }) => {
                  const mealValue = meals[key];
                  // "X" 또는 빈 문자열이면 표시하지 않음
                  if (!mealValue || mealValue === "X" || mealValue.trim() === "") {
                    return null;
                  }

                  return (
                    <div key={key} className="flex gap-3">
                      <span className="text-sm font-medium text-gray-700">
                        {label}:
                      </span>
                      <span className="text-sm text-gray-600">
                        {mealValue}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 숙소 정보 */}
            {day.accommodation && (
              <div className="pl-5">
                <div className="flex gap-3">
                  <span className="text-sm font-medium text-gray-700">
                    숙소:
                  </span>
                  <span className="text-sm text-gray-600">
                    {day.accommodation}
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
