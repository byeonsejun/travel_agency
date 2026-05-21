export function maskPassportNo(no: string): string {
  if (no.length < 4) return "****";
  return `${no.slice(0, 2)}****${no.slice(-2)}`;
}
