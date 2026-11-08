/** Public stock is available stock. Admin endpoints retain physical stock. */
export function availableVariant<T extends { stock_quantity: number; reserved_quantity: number }>(variant: T): T {
  return { ...variant, stock_quantity: Math.max(0, variant.stock_quantity - variant.reserved_quantity) };
}

export function availableProduct<T extends { product_variants: { stock_quantity: number; reserved_quantity: number }[] }>(product: T) {
  return { ...product, product_variants: product.product_variants.map(availableVariant) };
}
