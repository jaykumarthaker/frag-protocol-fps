/**
 * Cash Raid buy-station catalogue. The base game ships four weapons
 * (railgun / shard / rocket / pulse); the design doc's SMG/AR/Shotgun/Sniper
 * list is mapped onto them by price tier. `pulse` is the free starter weapon
 * and is not sold.
 */
export interface ShopItem {
  id: string;
  label: string;
  kind: 'weapon' | 'ammo' | 'armor';
  /** WEAPONS key for weapon items. */
  weaponId?: string;
  cost: number;
  /** Armor points for armor items. */
  amount?: number;
  blurb: string;
}

export const SHOP_ITEMS: ShopItem[] = [
  { id: 'shard',   label: 'SHARD CANNON',    kind: 'weapon', weaponId: 'shard',   cost: 2000, blurb: '9-pellet flak spread' },
  { id: 'pulse_x', label: 'PULSE — REFILL',  kind: 'ammo',   cost: 800,           blurb: 'top up every weapon' },
  { id: 'railgun', label: 'RAILGUN',         kind: 'weapon', weaponId: 'railgun', cost: 4000, blurb: 'instant-hit sniper' },
  { id: 'rocket',  label: 'ROCKET LAUNCHER', kind: 'weapon', weaponId: 'rocket',  cost: 6000, blurb: 'splash + rocket jump' },
  { id: 'armor',   label: 'ARMOR PLATING',   kind: 'armor',  cost: 1500, amount: 75, blurb: '+75 armor' },
];

export function shopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((s) => s.id === id);
}
