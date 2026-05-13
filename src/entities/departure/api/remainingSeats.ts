export function computeRemainingSeats(
  capacity: number,
  bookedSeats: number
): number {
  return Math.max(0, capacity - bookedSeats);
}
