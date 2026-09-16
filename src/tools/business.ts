// Mock business data source. Deterministic per key (same key -> same snapshot).
export interface OrderSnapshot {
  order_id: string;
  status: string;
  amount: number;
  created_at: string;
  product: string;
  tracking_no: string;
}

// FNV-1a string hash feeding a mulberry32 PRNG: stable across runs, unlike Math.random.
function seedFrom(key: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function orderSnapshot(orderId: string): OrderSnapshot {
  const rng = seedFrom(`order:${orderId}`);
  return {
    order_id: orderId,
    status: pick(rng, ["awaiting payment", "paid", "shipped", "delivered"]),
    amount: randInt(rng, 50, 2000),
    created_at: `2026-07-${String(randInt(rng, 1, 12)).padStart(2, "0")} 10:00`,
    product: pick(rng, ["Smart Litter Box", "Cat food 5kg", "Cat tree", "Automatic water fountain"]),
    tracking_no: `SF${randInt(rng, 10 ** 11, 10 ** 12 - 1)}`,
  };
}

// Demo orders referenced across docs and acceptance scripts.
export const DEMO_ORDER_IDS = ["1001", "2002"] as const;

export interface UserOrder {
  order_id: string;
  product: string;
  status: string;
  amount: number;
}

export function listUserOrders(userId: string): UserOrder[] {
  const rng = seedFrom(`user_orders:${userId}`);
  const ids: string[] = [...DEMO_ORDER_IDS];
  const extra = randInt(rng, 2, 4);
  for (let i = 0; i < extra; i += 1) {
    const oid = String(randInt(rng, 1000, 9999));
    if (!ids.includes(oid)) {
      ids.push(oid);
    }
  }
  return ids.map((oid) => {
    const s = orderSnapshot(oid);
    return { order_id: oid, product: s.product, status: s.status, amount: s.amount };
  });
}

export function ownsOrder(userId: string, orderId: string): boolean {
  // Empty user id never passes: identity is injected, not user-supplied.
  if (!userId || !orderId) {
    return false;
  }
  return listUserOrders(userId).some((o) => o.order_id === orderId);
}

export interface ProductSnapshot {
  product_name: string;
  price: number;
  stock: number;
  spec: string;
}

export function productSnapshot(productName: string): ProductSnapshot {
  const rng = seedFrom(`product:${productName}`);
  return {
    product_name: productName,
    price: randInt(rng, 20, 999),
    stock: randInt(rng, 0, 500),
    spec: pick(rng, ["Standard pack", "Family pack", "Trial pack"]),
  };
}
