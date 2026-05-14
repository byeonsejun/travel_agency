interface PricingInput {
  priceAdult: number;
  priceChild: number;
  priceInfant: number;
  adultCount: number;
  childCount: number;
  infantCount: number;
}

export function computeTotalPrice(input: PricingInput): number {
  const { priceAdult, priceChild, priceInfant, adultCount, childCount, infantCount } = input;
  return (
    priceAdult * adultCount +
    priceChild * childCount +
    priceInfant * infantCount
  );
}
