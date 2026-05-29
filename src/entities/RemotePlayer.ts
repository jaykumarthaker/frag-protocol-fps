import * as THREE from 'three';
import { Actor, ACTOR_FEET_OFFSET } from './Actor';
import { createCharacter, createHalo, type CharacterInstance, type CharacterAnim } from '../core/Models';
import { makeNameTag } from './nameTag';
import { createCashTag, type CashTag } from './cashTag';
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
  private robot: CharacterInstance;
  private cashTag: CashTag;
  private buffer: Snap[] = [];

  constructor(game: Game, np: NetPlayer) {
    super(game, np.name, np.color, new THREE.Vector3(np.x, np.y, np.z));
    this.netId = np.id;
    this.characterId = np.character || 'robot';
    this.robot = createCharacter(
      this.characterId, np.color, game.settings.quality === 'high',
    );
    this.mesh.add(this.robot.root);
    this.mesh.add(createHalo(np.color));
    this.mesh.add(makeNameTag(np.name, np.color));
    this.cashTag = createCashTag();
    this.mesh.add(this.cashTag.sprite);
    this.applySnapshot(np);
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
    this.cashTag.setAmount(this.alive ? this.carried : 0);
    this.robot.play((this.anim as CharacterAnim) || 'Idle');
  }
}

function lerpAngle(from: number, to: number, t: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}
