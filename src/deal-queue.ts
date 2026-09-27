export async function runDealQueue<T>(cards: readonly T[], dealCard: (card: T) => Promise<void>): Promise<void> {
  for (const card of cards) await dealCard(card);
}
