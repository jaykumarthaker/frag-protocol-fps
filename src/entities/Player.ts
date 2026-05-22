import * as THREE from 'three';
import { Actor, ACTOR_EYE_OFFSET } from './Actor';
import type { Game } from '../core/Game';
import { forwardXZ, rightXZ, lookDir } from '../core/look';
import { WEAPON_ORDER } from '../weapons/Weapons';
import { createWeaponMesh, type WeaponMesh } from '../weapons/WeaponModels';

const DODGE_TAP_WINDOW = 0.28;
const PITCH_LIMIT = Math.PI / 2 - 0.04;
/** Seconds between queued rockets, and the railgun's wind-up duration. */
const ROCKET_LOAD_INTERVAL = 0.2;
const RAIL_WINDUP = 0.14;
const SHARD_CHARGE_TIME = 0.9;

/** The human-controlled actor: input → movement intent, camera, viewmodel. */
export class Player extends Actor {
  private camera: THREE.PerspectiveCamera;
  private viewmodelRoot = new THREE.Group();
  private viewmodels: Record<string, WeaponMesh> = {};
  private lastTap: Record<string, number> = {};
  private bobPhase = 0;
  private recoil = 0;
  private camRoll = 0;
  private fwdInput = 0;
  private strafeInput = 0;

  // --- UT-feel weapon state ---
  /** Rockets queued in the triple-rocket launcher (0..3). */
  private rocketLoaded = 0;
  private rocketLoadAt = 0;
  /** Shard Cannon charged-secondary build-up (0..1). */
  private shardCharge = 0;
  /** game.time the railgun wind-up began (0 = not winding up). */
  private railChargeStart = 0;

  constructor(game: Game, name: string, spawnFeet: THREE.Vector3, camera: THREE.PerspectiveCamera) {
    super(game, name, 0x36e0ff, spawnFeet);
    this.camera = camera;
    this.buildViewmodels();
    camera.add(this.viewmodelRoot);
  }

  private buildViewmodels() {
    for (const id of WEAPON_ORDER) {
      const g = createWeaponMesh(id);
      g.visible = false;
      this.viewmodelRoot.add(g);
      this.viewmodels[id] = g;
    }
    this.viewmodelRoot.position.set(0.34, -0.34, -0.72);
  }

  /** Recoil + viewmodel kick after a successful shot — heavier per weapon. */
  onFired(weaponId: string) {
    const kick = weaponId === 'railgun' ? 1.0
      : weaponId === 'rocket' ? 0.9
      : weaponId === 'shard' ? 0.66
      : 0.32; // pulse — a light buzz
    this.recoil = Math.min(1.2, this.recoil + kick);
  }

  update(dt: number) {
    const input = this.game.input;

    if (!this.alive) {
      // freeze on death; Game runs the respawn timer
      this.rocketLoaded = 0;
      this.shardCharge = 0;
      this.railChargeStart = 0;
      this.applyCamera(dt, 0);
      this.updateViewmodel(dt);
      return;
    }

    // ---- mouse look ----
    const sens = this.game.settings.sensitivity * 0.0022;
    this.yaw -= input.mouseDX * sens;
    this.pitch -= input.mouseDY * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);

    // ---- movement intent ----
    const f = (input.key('KeyW') ? 1 : 0) - (input.key('KeyS') ? 1 : 0);
    const s = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0);
    this.fwdInput = f;
    this.strafeInput = s;
    const wish = new THREE.Vector3();
    wish.addScaledVector(forwardXZ(this.yaw), f);
    wish.addScaledVector(rightXZ(this.yaw), s);

    const wantJump = input.keyPressed('Space');
    const dodgeDir = this.detectDodge(input, f, s);

    this.move(dt, wish, wantJump, dodgeDir);

    // ---- weapon switching ----
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      if (input.keyPressed(`Digit${i + 1}`)) this.switchWeapon(WEAPON_ORDER[i]);
    }
    if (input.wheelDelta !== 0) this.cycleWeapon(input.wheelDelta > 0 ? 1 : -1);
    if (input.keyPressed('KeyQ')) this.cycleWeapon(1);

    // ---- firing ----
    this.updateWeaponFire(dt);

    this.applyCamera(dt, s);
    this.updateViewmodel(dt);
  }

  /**
   * Per-weapon firing — most weapons just fire on the mouse button, but the
   * Rocket Launcher queues a triple salvo, the Shard Cannon charges its
   * secondary, and the Railgun winds up briefly before its instant shot.
   */
  private updateWeaponFire(dt: number) {
    const input = this.game.input;
    const w = this.currentWeapon;
    const primary = input.mouse(0);
    const secondary = input.mouse(2);

    // drop any queued / charged state when the weapon changed
    if (w !== 'rocket') this.rocketLoaded = 0;
    if (w !== 'shard') this.shardCharge = 0;
    if (w !== 'railgun') this.railChargeStart = 0;

    if (w === 'rocket') {
      const ammo = this.ammo.rocket ?? 0;
      if (primary && this.rocketLoaded < 3 && this.rocketLoaded < ammo &&
          this.canFire() && this.game.time >= this.rocketLoadAt) {
        this.rocketLoaded++;
        this.rocketLoadAt = this.game.time + ROCKET_LOAD_INTERVAL;
        this.game.audio.play('rocketload', this.position);
      }
      // release the salvo when the button is let go or the queue is full
      if (this.rocketLoaded > 0 && (!primary || this.rocketLoaded >= 3)) {
        if (this.game.weapons.fireRocketSalvo(this, this.rocketLoaded)) this.onFired('rocket');
        this.rocketLoaded = 0;
      }
      return;
    }

    if (w === 'shard') {
      if (primary && this.game.weapons.fire(this, false)) this.onFired('shard');
      if (secondary && this.canFire() && (this.ammo.shard ?? 0) >= 2) {
        this.shardCharge = Math.min(1, this.shardCharge + dt / SHARD_CHARGE_TIME);
      } else if (this.shardCharge > 0) {
        if (this.game.weapons.fire(this, true, this.shardCharge)) this.onFired('shard');
        this.shardCharge = 0;
      }
      return;
    }

    if (w === 'railgun') {
      // pressing fire commits a wind-up; the shot lands even if released early
      if (this.railChargeStart === 0 && primary &&
          this.canFire() && (this.ammo.railgun ?? 0) >= 1) {
        this.railChargeStart = this.game.time;
        this.game.audio.play('railcharge', this.position);
      }
      if (this.railChargeStart > 0 && this.game.time - this.railChargeStart >= RAIL_WINDUP) {
        if (this.game.weapons.fire(this, false)) this.onFired('railgun');
        this.railChargeStart = 0;
      }
      return;
    }

    // pulse + anything else: straightforward primary / secondary fire
    if (primary) {
      if (this.game.weapons.fire(this, false)) this.onFired(w);
    } else if (secondary) {
      if (this.game.weapons.fire(this, true)) this.onFired(w);
    }
  }

  /** Double-tap a strafe/forward key to dodge in that direction. */
  private detectDodge(
    input: import('../core/Input').Input, f: number, s: number,
  ): THREE.Vector3 | null {
    const t = this.game.time;
    const keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD'];
    for (const k of keys) {
      if (!input.keyPressed(k)) continue;
      const prev = this.lastTap[k] ?? -99;
      this.lastTap[k] = t;
      if (t - prev < DODGE_TAP_WINDOW) {
        // dodge in the currently-held movement direction
        const dir = new THREE.Vector3();
        dir.addScaledVector(forwardXZ(this.yaw), f || (k === 'KeyW' ? 1 : k === 'KeyS' ? -1 : 0));
        dir.addScaledVector(rightXZ(this.yaw), s || (k === 'KeyD' ? 1 : k === 'KeyA' ? -1 : 0));
        if (dir.lengthSq() > 1e-4) return dir;
      }
    }
    return null;
  }

  private applyCamera(dt: number, strafe: number) {
    // view-bob while moving on the ground
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.grounded) this.bobPhase += dt * speed * 1.1;
    const bob = this.grounded ? Math.sin(this.bobPhase) * 0.035 * Math.min(1, speed / 8) : 0;

    const eye = this.eyePosition();
    eye.y += bob;
    this.camera.position.copy(eye);

    // slight roll toward the strafe direction
    const targetRoll = -strafe * 0.045;
    this.camRoll += (targetRoll - this.camRoll) * Math.min(1, dt * 12);

    const dir = lookDir(this.yaw, this.pitch);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(eye.clone().add(dir));
    this.camera.rotateZ(this.camRoll);

    // ---- camera shake (weapon kick, hits, nearby blasts) ----
    const tr = this.game.shakeTrauma;
    if (tr > 0.001) {
      const s = tr * tr;
      const t = this.game.time;
      this.camera.position.x += Math.sin(t * 47.0) * 0.16 * s;
      this.camera.position.y += Math.sin(t * 58.3) * 0.16 * s;
      this.camera.position.z += Math.sin(t * 53.1) * 0.10 * s;
      this.camera.rotateZ(Math.sin(t * 43.7) * 0.055 * s);
      this.camera.rotateX(Math.sin(t * 61.2) * 0.045 * s);
    }
  }

  private updateViewmodel(dt: number) {
    for (const id of WEAPON_ORDER) {
      this.viewmodels[id].visible = id === this.currentWeapon;
    }
    this.recoil = Math.max(0, this.recoil - dt * 6);
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    const sway = Math.sin(this.bobPhase) * 0.012 * Math.min(1, speed / 8);
    this.viewmodelRoot.position.set(
      0.34 + sway,
      -0.34 + Math.abs(sway) * 0.5 - this.recoil * 0.03,
      -0.72 + this.recoil * 0.12,
    );
    this.viewmodelRoot.rotation.x = this.recoil * 0.35;

    // drive the active weapon's idle animation; `energy` brightens its glow
    // while a shot recoils or a charge / wind-up builds.
    let energy = Math.min(1, this.recoil);
    if (this.currentWeapon === 'shard') {
      energy = Math.max(energy, this.shardCharge);
    } else if (this.currentWeapon === 'rocket') {
      energy = Math.max(energy, this.rocketLoaded / 3);
    } else if (this.currentWeapon === 'railgun' && this.railChargeStart > 0) {
      energy = Math.max(energy, Math.min(1, (this.game.time - this.railChargeStart) / RAIL_WINDUP));
    }
    const vm = this.viewmodels[this.currentWeapon];
    if (vm) vm.userData.animate(this.game.time, energy);
  }

  /** World position of the camera eye (for HUD / spectator math). */
  get eyeY(): number { return this.position.y + ACTOR_EYE_OFFSET; }

  /** Detach the viewmodel from the camera when the match ends. */
  dispose() {
    this.camera.remove(this.viewmodelRoot);
  }
}
