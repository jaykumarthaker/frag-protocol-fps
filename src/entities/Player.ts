import * as THREE from 'three';
import { Actor, ACTOR_EYE_OFFSET } from './Actor';
import type { Game } from '../core/Game';
import { forwardXZ, rightXZ, lookDir } from '../core/look';
import { WEAPONS, WEAPON_ORDER, type WeaponDef } from '../weapons/Weapons';

const DODGE_TAP_WINDOW = 0.28;
const PITCH_LIMIT = Math.PI / 2 - 0.04;

/** The human-controlled actor: input → movement intent, camera, viewmodel. */
export class Player extends Actor {
  private camera: THREE.PerspectiveCamera;
  private viewmodelRoot = new THREE.Group();
  private viewmodels: Record<string, THREE.Group> = {};
  private lastTap: Record<string, number> = {};
  private bobPhase = 0;
  private recoil = 0;
  private camRoll = 0;
  private fwdInput = 0;
  private strafeInput = 0;

  constructor(game: Game, name: string, spawnFeet: THREE.Vector3, camera: THREE.PerspectiveCamera) {
    super(game, name, 0x36e0ff, spawnFeet);
    this.camera = camera;
    this.buildViewmodels();
    camera.add(this.viewmodelRoot);
  }

  private buildViewmodels() {
    for (const id of WEAPON_ORDER) {
      const g = this.buildWeaponModel(id, WEAPONS[id]);
      g.visible = false;
      this.viewmodelRoot.add(g);
      this.viewmodels[id] = g;
    }
    this.viewmodelRoot.position.set(0.34, -0.34, -0.72);
  }

  /** A distinct low-poly viewmodel per weapon, with glowing accents. */
  private buildWeaponModel(id: string, def: WeaponDef): THREE.Group {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x171f2c, roughness: 0.45, metalness: 0.8 });
    const mid = new THREE.MeshStandardMaterial({ color: 0x2c3748, roughness: 0.5, metalness: 0.65 });
    const accent = new THREE.MeshStandardMaterial({
      color: def.color, emissive: def.color, emissiveIntensity: 0.5, roughness: 0.3,
    });
    const part = (
      geo: THREE.BufferGeometry, mat: THREE.Material,
      x: number, y: number, z: number, rx = 0,
    ) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      g.add(m);
    };

    part(new THREE.BoxGeometry(0.1, 0.22, 0.13), dark, 0, -0.13, 0.16); // grip

    switch (id) {
      case 'railgun':
        part(new THREE.BoxGeometry(0.12, 0.13, 0.62), mid, 0, 0, -0.05);
        part(new THREE.CylinderGeometry(0.035, 0.045, 0.72, 10), dark, 0, 0.02, -0.38, Math.PI / 2);
        part(new THREE.BoxGeometry(0.06, 0.11, 0.26), dark, 0, 0.13, 0.0);
        part(new THREE.CylinderGeometry(0.028, 0.028, 0.52, 8), accent, 0, 0.04, -0.32, Math.PI / 2);
        break;
      case 'shard':
        part(new THREE.BoxGeometry(0.22, 0.16, 0.4), mid, 0, 0, -0.02);
        part(new THREE.CylinderGeometry(0.07, 0.085, 0.34, 8), dark, -0.07, 0, -0.32, Math.PI / 2);
        part(new THREE.CylinderGeometry(0.07, 0.085, 0.34, 8), dark, 0.07, 0, -0.32, Math.PI / 2);
        part(new THREE.BoxGeometry(0.24, 0.05, 0.1), accent, 0, 0.1, -0.02);
        break;
      case 'rocket':
        part(new THREE.BoxGeometry(0.16, 0.16, 0.4), mid, 0, 0, 0.02);
        part(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 12), dark, 0, 0.03, -0.32, Math.PI / 2);
        part(new THREE.ConeGeometry(0.085, 0.18, 12), accent, 0, 0.03, -0.52, -Math.PI / 2);
        part(new THREE.TorusGeometry(0.13, 0.022, 8, 18), accent, 0, 0.03, -0.12);
        break;
      case 'pulse':
        part(new THREE.BoxGeometry(0.14, 0.15, 0.5), mid, 0, 0, -0.04);
        part(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10), dark, 0, 0.04, -0.34, Math.PI / 2);
        part(new THREE.SphereGeometry(0.085, 16, 12), accent, 0, 0.05, 0.07);
        part(new THREE.BoxGeometry(0.045, 0.18, 0.05), accent, 0, 0.13, -0.12);
        break;
    }
    return g;
  }

  /** Recoil + viewmodel kick after a successful shot. */
  onFired() { this.recoil = Math.min(1, this.recoil + 0.7); }

  update(dt: number) {
    const input = this.game.input;

    if (!this.alive) {
      // freeze on death; Game runs the respawn timer
      this.applyCamera(dt, 0);
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
    if (input.mouse(0)) {
      if (this.game.weapons.fire(this, false)) this.onFired();
    } else if (input.mouse(2)) {
      if (this.game.weapons.fire(this, true)) this.onFired();
    }

    this.applyCamera(dt, s);
    this.updateViewmodel(dt);
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
  }

  /** World position of the camera eye (for HUD / spectator math). */
  get eyeY(): number { return this.position.y + ACTOR_EYE_OFFSET; }

  /** Detach the viewmodel from the camera when the match ends. */
  dispose() {
    this.camera.remove(this.viewmodelRoot);
  }
}
