import * as THREE from 'three';

/**
 * A floating gold "carrying cash" badge for actors in Cash Raid. Sits just
 * above the name tag, hidden unless the actor is carrying money. Lets allies
 * know whom to protect and enemies know whom to chase. The canvas is only
 * redrawn when the displayed amount actually changes (cash moves in discrete
 * raid/bank/pickup steps), so it's cheap per frame.
 */
export interface CashTag {
  sprite: THREE.Sprite;
  setAmount(amount: number): void;
  dispose(): void;
}

export function createCashTag(): CashTag {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, depthTest: false, transparent: true,
  }));
  spr.position.y = 2.78;            // just above the name tag (y = 2.15)
  spr.scale.set(2.0, 0.5, 1);
  spr.visible = false;
  spr.renderOrder = 999;

  let shown = -1;

  const draw = (amount: number) => {
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = '#ffd23f';                 // gold pill
    roundRect(ctx, 20, 12, 216, 40, 12);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(8,12,20,0.85)';
    ctx.stroke();
    ctx.fillStyle = '#0a0e16';
    ctx.font = 'bold 30px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$' + amount.toLocaleString(), 128, 33);
    tex.needsUpdate = true;
  };

  return {
    sprite: spr,
    setAmount(amount: number) {
      const a = Math.floor(amount);
      if (a <= 0) { spr.visible = false; shown = 0; return; }
      spr.visible = true;
      if (a !== shown) { draw(a); shown = a; }
    },
    dispose() {
      spr.material.map?.dispose();
      spr.material.dispose();
    },
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
