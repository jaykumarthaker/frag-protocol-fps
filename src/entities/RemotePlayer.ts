import * as THREE from 'three';
import { Actor, ACTOR_FEET_OFFSET } from './Actor';
import { createRobot, type RobotInstance, type RobotAnim } from '../core/Models';
import type { Game } from '../core/Game';
import type { NetPlayer } from '../net/protocol';

/** Seconds of snapshot buffering — remotes render this far in the past. */
const INTERP_DELAY = 0.11;

interface Snap { t: number; x: number; y: number; z: number; yaw: number; }

/**
 * Another human player in an online match. Health/score/alive come straight
 * from server snapshots; position + yaw are interpolated between snapshots so
 * remote motion stays smooth despite the 20 Hz update rate.
 */
export class RemotePlayer extends Actor {
  netId: number;
  anim = 'Idle';
  private robot: RobotInstance;
  private buffer: Snap[] = [];

  constructor(game: Game, np: NetPlayer) {
    super(game, np.name, np.color, new THREE.Vector3(np.x, np.y, np.z));
    this.netId = np.id;
    this.robot = createRobot(np.color);
    this.mesh.add(this.robot.root);
    this.mesh.add(this.makeNameTag(np.name));
    this.applySnapshot(np);
  }

  private makeNameTag(name: string): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.font = 'bold 34px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(8,12,20,0.7)';
    ctx.fillRect(0, 8, 256, 48);
    ctx.fillStyle = '#' + this.colorHex.toString(16).padStart(6, '0');
    ctx.fillText(name.toUpperCase(), 128, 33);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.position.y = 2.15;
    spr.scale.set(2.4, 0.6, 1);
    return spr;
  }

  /** Ingest an authoritative server snapshot of this player. */
  applySnapshot(np: NetPlayer) {
    this.buffer.push({
      t: performance.now(),
      x: np.x, y: np.y + ACTOR_FEET_OFFSET, z: np.z, yaw: np.yaw,
    });
    if (this.buffer.length > 8) this.buffer.shift();

    this.health = np.health;
    this.armor = np.armor;
    this.frags = np.frags;
    this.deaths = np.deaths;
    this.team = np.team;
    this.carried = np.carried;
    this.moneyBanked = np.moneyBanked;
    this.moneyStolen = np.moneyStolen;
    this.anim = np.anim;
    this.currentWeapon = np.weapon;
    if (this.alive !== np.alive) {
      this.alive = np.alive;
      this.collider.setEnabled(np.alive);
    }
  }

  /** Interpolate to `renderTime` ms (performance.now()), then animate. */
  tick(renderTime: number, dt: number) {
    const target = renderTime - INTERP_DELAY * 1000;
    const buf = this.buffer;

    if (buf.length === 1) {
      this.position.set(buf[0].x, buf[0].y, buf[0].z);
      this.yaw = buf[0].yaw;
    } else if (buf.length >= 2) {
      let a = buf[0];
      let b = buf[buf.length - 1];
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= target && buf[i + 1].t >= target) { a = buf[i]; b = buf[i + 1]; break; }
        if (buf[i + 1].t <= target) { a = buf[i]; b = buf[i + 1]; }
      }
      const span = b.t - a.t;
      const k = span > 1e-3 ? THREE.MathUtils.clamp((target - a.t) / span, 0, 1) : 1;
      this.position.set(
        THREE.MathUtils.lerp(a.x, b.x, k),
        THREE.MathUtils.lerp(a.y, b.y, k),
        THREE.MathUtils.lerp(a.z, b.z, k),
      );
      this.yaw = lerpAngle(a.yaw, b.yaw, k);
    }

    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y, z: this.position.z });
    this.syncMesh(dt);
  }

  protected override updateVisual(dt: number) {
    this.robot.setWeapon(this.currentWeapon);
    this.robot.update(dt);
    this.robot.play((this.anim as RobotAnim) || 'Idle');
  }
}

function lerpAngle(from: number, to: number, t: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}
