/** Locked USD catalog. Never accept free-form amounts from the client. */
export const CHECKOUT_CATALOG = [
  { id: "tip-5", usd: 5, cents: 500, label: "Signal $5" },
  { id: "tip-10", usd: 10, cents: 1000, label: "Boost $10" },
  { id: "tip-25", usd: 25, cents: 2500, label: "Spotlight $25" },
  { id: "tip-50", usd: 50, cents: 5000, label: "Headline $50" },
] as const;

export type CatalogItem = (typeof CHECKOUT_CATALOG)[number];
export type CatalogSku = CatalogItem["id"];

export function catalogBySku(sku: string): CatalogItem | null {
  return CHECKOUT_CATALOG.find((item) => item.id === sku) ?? null;
}

export function isCatalogSku(sku: string): sku is CatalogSku {
  return catalogBySku(sku) !== null;
}
