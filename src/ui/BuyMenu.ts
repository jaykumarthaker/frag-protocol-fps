import { SHOP_ITEMS } from '../game/shop';

/** State the buy menu renders from. */
export interface BuyState {
  bank: number;
  /** Weapon ids the player already owns (greyed out in the list). */
  owned: Set<string>;
}

/**
 * The in-match buy menu — an HTML overlay. Purely a renderer: Game owns the
 * open/close state and routes the number-key purchases. On touch the rows and
 * a close button are tappable (the digit keys still work for keyboard play).
 */
export class BuyMenu {
  private root: HTMLDivElement;
  private open = false;
  /** Tap-to-buy a row by its index; wired by Game (mirrors the digit keys). */
  onBuy: ((index: number) => void) | null = null;
  /** Tap-to-close (touch); mirrors the B / ESC keys. */
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'buymenu';
    this.root.className = 'hidden';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.buy-close') || t === this.root) { this.onClose?.(); return; }
      const row = t.closest('.buy-item') as HTMLElement | null;
      if (row && row.dataset.index) this.onBuy?.(Number(row.dataset.index));
    });
  }

  get isOpen() { return this.open; }

  show(state: BuyState) {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render(state);
  }

  /** Re-render with fresh state (after a purchase). */
  refresh(state: BuyState) {
    if (this.open) this.render(state);
  }

  close() {
    this.open = false;
    this.root.classList.add('hidden');
  }

  private render(state: BuyState) {
    const rows = SHOP_ITEMS.map((it, i) => {
      const owned = it.kind === 'weapon' && !!it.weaponId && state.owned.has(it.weaponId);
      const afford = state.bank >= it.cost;
      const cls = owned ? 'owned' : afford ? '' : 'broke';
      const status = owned ? 'OWNED' : `$${it.cost.toLocaleString()}`;
      return `<div class="buy-item ${cls}" data-index="${i}">
        <span class="bi-key">${i + 1}</span>
        <span class="bi-label">${it.label}</span>
        <span class="bi-blurb">${it.blurb}</span>
        <span class="bi-cost">${status}</span>
      </div>`;
    }).join('');
    this.root.innerHTML = `<div class="buy-panel">
      <div class="buy-head">BUY STATION
        <span class="buy-bank">TEAM BANK&nbsp; $${state.bank.toLocaleString()}</span>
        <button class="buy-close" aria-label="close">✕</button>
      </div>
      ${rows}
      <div class="buy-foot">tap an item, or press 1–${SHOP_ITEMS.length} &nbsp;·&nbsp; B / ESC to close</div>
    </div>`;
  }
}
