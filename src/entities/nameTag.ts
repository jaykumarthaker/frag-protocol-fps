import * as THREE from 'three';

/**
 * A floating name-tag sprite for remote players and bots. The background uses
 * the actor's team / player colour so allies, enemies and individuals are
 * immediately identifiable above the (now un-tinted) character model.
 */
export function makeNameTag(name: string, colorHex: number): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d')!;

  const hex = '#' + colorHex.toString(16).padStart(6, '0');
  // Coloured pill background with a darker rim for readability.
  ctx.fillStyle = hex;
  roundRect(ctx, 6, 10, 244, 44, 12);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(8,12,20,0.85)';
  ctx.stroke();

  // Pick text colour by luminance so it stays readable on any team hue.
  const r = (colorHex >> 16) & 0xff;
  const g = (colorHex >> 8) & 0xff;
  const b = colorHex & 0xff;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  ctx.fillStyle = lum > 150 ? '#0a0e16' : '#ffffff';

  ctx.font = 'bold 30px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.toUpperCase(), 128, 33);

  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, depthTest: false, transparent: true,
  }));
  spr.position.y = 2.15;
  spr.scale.set(2.4, 0.6, 1);
  return spr;
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
