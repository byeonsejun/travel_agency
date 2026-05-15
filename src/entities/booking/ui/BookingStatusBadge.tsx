import type { BookingStatus } from "@prisma/client";
import { BOOKING_STATUS_LABEL } from "../model/constants";

const STATUS_STYLE: Record<BookingStatus, string> = {
  RECEIVED:           "bg-blue-100 text-blue-800",
  AWAITING_GROUP:     "bg-yellow-100 text-yellow-800",
  DEPARTURE_CONFIRMED:"bg-green-100 text-green-800",
  PAID:               "bg-emerald-100 text-emerald-800",
  READY:              "bg-purple-100 text-purple-800",
  COMPLETED:          "bg-gray-100 text-gray-600",
  CANCELED_BY_USER:   "bg-red-100 text-red-700",
  CANCELED_BY_AGENCY: "bg-red-100 text-red-700",
};

type Props = { status: BookingStatus };

export function BookingStatusBadge({ status }: Props) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${STATUS_STYLE[status]}`}
    >
      {BOOKING_STATUS_LABEL[status]}
    </span>
  );
}
