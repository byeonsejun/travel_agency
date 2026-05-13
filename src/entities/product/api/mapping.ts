export type RawDepartureForPrice = {
  priceAdult: number;
};

export function pickLowestPrice(
  departures: RawDepartureForPrice[]
): number | null {
  if (departures.length === 0) {
    return null;
  }

  return departures.sort((a, b) => a.priceAdult - b.priceAdult)[0]
    .priceAdult;
}
