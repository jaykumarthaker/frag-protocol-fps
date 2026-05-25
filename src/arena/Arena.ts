import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../physics/Physics';
import type { PickupType } from '../entities/Pickup';

export interface PickupSpawn {
  type: PickupType;
  pos: THREE.Vector3;
}

export interface JumpPad {
  /** Centre of the trigger box. */
  pos: THREE.Vector3;
  halfExtents: THREE.Vector3;
  /** Velocity applied to an actor that steps on the pad. */
  launch: THREE.Vector3;
  mesh: THREE.Mesh;
}

/**
 * The "blockout" arena — built procedurally from boxes and rotated ramps with
 * a prototype-grid texture. Provides spawn points, pickup spots, jump pads and
 * an AI waypoint graph. A proper art-pass map (CC0 modular kit) is milestone 6.
 */
export class Arena {
  root = new THREE.Group();

  spawnPoints: THREE.Vector3[] = [];
  pickupSpawns: PickupSpawn[] = [];
  jumpPads: JumpPad[] = [];
  waypoints: THREE.Vector3[] = [];
  waypointLinks: number[][] = [];

  protected scene: THREE.Scene;
  protected physics: Physics;

  /** Static colliders this arena owns — released by dispose(). */
  protected colliders: RAPIER.Collider[] = [];

  protected matFloor!: THREE.Material;
  protected matWall!: THREE.Material;
  protected matStruct!: THREE.Material;
  protected matTrim!: THREE.Material;

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene = scene;
    this.physics = physics;
  }

  build() {
    this.makeMaterials();
    this.scene.add(this.root);

    const HALF = 32; // arena floor half-size (64 x 64)
    const WALL_H = 17;

    // ---- floor ----
    this.box(0, -1, 0, HALF * 2, 2, HALF * 2, this.matFloor);

    // ---- outer walls ----
    this.box(0, WALL_H / 2, -HALF, HALF * 2, WALL_H, 1.5, this.matWall);
    this.box(0, WALL_H / 2, HALF, HALF * 2, WALL_H, 1.5, this.matWall);
    this.box(-HALF, WALL_H / 2, 0, 1.5, WALL_H, HALF * 2, this.matWall);
    this.box(HALF, WALL_H / 2, 0, 1.5, WALL_H, HALF * 2, this.matWall);

    // ---- central raised platform (top at y = 4.5) ----
    const PT = 4.5;
    const PH = 7; // platform half-width (14 wide)
    this.box(0, PT / 2, 0, PH * 2, PT, PH * 2, this.matStruct);
    this.trimRing(0, PT + 0.06, 0, PH, 0xff7a18);

    // ---- four ramps up to the central platform ----
    this.ramp(new THREE.Vector3(0, 0, 16), new THREE.Vector3(0, PT, PH), 5.5);
    this.ramp(new THREE.Vector3(0, 0, -16), new THREE.Vector3(0, PT, -PH), 5.5);
    this.ramp(new THREE.Vector3(16, 0, 0), new THREE.Vector3(PH, PT, 0), 5.5);
    this.ramp(new THREE.Vector3(-16, 0, 0), new THREE.Vector3(-PH, PT, 0), 5.5);

    // ---- side sniper ledges (reached by jump pads) ----
    const LEDGE_Y = 6;
    this.box(HALF - 3.5, LEDGE_Y, 0, 6, 1, 24, this.matStruct);
    this.box(-(HALF - 3.5), LEDGE_Y, 0, 6, 1, 24, this.matStruct);

    // ---- cover pillars + low crates ----
    const pillars: [number, number][] = [
      [14, 14], [-14, 14], [14, -14], [-14, -14],
    ];
    for (const [x, z] of pillars) this.box(x, 2.5, z, 2, 5, 2, this.matStruct);
    const crates: [number, number][] = [
      [9, -2], [-9, 2], [2, 9], [-2, -9], [20, 8], [-20, -8],
    ];
    for (const [x, z] of crates) this.box(x, 1, z, 3, 2, 3, this.matStruct);

    // ---- jump pads ----
    this.addJumpPad(new THREE.Vector3(HALF - 9, 0, 0), new THREE.Vector3(2, 26.5, 0));
    this.addJumpPad(new THREE.Vector3(-(HALF - 9), 0, 0), new THREE.Vector3(-2, 26.5, 0));

    // ---- spawn points (feet positions on the floor) ----
    const sp: [number, number][] = [
      [22, 22], [-22, 22], [22, -22], [-22, -22],
      [26, 0], [-26, 0], [0, 26], [0, -26],
    ];
    for (const [x, z] of sp) this.spawnPoints.push(new THREE.Vector3(x, 0.05, z));

    // ---- pickups ----
    this.pickupSpawns.push({ type: 'amp', pos: new THREE.Vector3(0, PT + 1.0, 0) });
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3(HALF - 3.5, LEDGE_Y + 1.2, 0) });
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3(-(HALF - 3.5), LEDGE_Y + 1.2, 0) });
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(0, 1.2, 22) });
    for (const [x, z] of [[22, 22], [-22, 22], [22, -22], [-22, -22]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'health', pos: new THREE.Vector3(x, 1.2, z) });
    }
    for (const [x, z] of [[14, 0], [-14, 0], [0, -22], [11, 11], [-11, -11]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'ammo', pos: new THREE.Vector3(x, 1.2, z) });
    }

    // Step once so the query pipeline sees the static geometry before the
    // waypoint line-of-sight raycasts run.
    this.physics.step();

    // ---- AI waypoint graph ----
    this.buildWaypoints(PT);
  }

  /** Tear down all meshes + colliders so another arena can be built. */
  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const c of this.colliders) this.physics.removeCollider(c);
    this.colliders = [];
  }

  // -------------------------------------------------------------------

  protected makeMaterials() {
    // All surface textures are procedural 256x256 canvases generated once at
    // arena load and shared across every box that uses them — same memory
    // footprint as the old grid textures, just less video-game-y looking.
    const grid = (base: string, line: string, accent: string) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d')!;
      g.fillStyle = base;
      g.fillRect(0, 0, 256, 256);
      g.strokeStyle = line;
      g.lineWidth = 2;
      for (let i = 0; i <= 256; i += 32) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
      }
      g.strokeStyle = accent;
      g.lineWidth = 3;
      g.strokeRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return tex;
    };

    // Mottled concrete-ish texture: a base fill, a cheap two-octave value
    // noise, a sprinkle of brighter/darker speckles, and faint panel seams.
    // Reads as a real surface up close without paying for an actual PBR pack.
    const concrete = (
      base: [number, number, number],
      noise: number,
      speckLight: string,
      speckDark: string,
      seamColor: string | null,
    ) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d')!;
      const img = g.createImageData(256, 256);
      const d = img.data;
      // Deterministic hash-noise so each load looks identical.
      const n = (x: number, y: number) => {
        const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        return s - Math.floor(s);
      };
      const smooth = (x: number, y: number) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const a = n(xi, yi), b = n(xi + 1, yi);
        const cc = n(xi, yi + 1), dd = n(xi + 1, yi + 1);
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        return a + (b - a) * u + (cc + (dd - cc) * u - a - (b - a) * u) * v;
      };
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const v = smooth(x / 18, y / 18) * 0.65 + smooth(x / 5, y / 5) * 0.35;
          const k = (v - 0.5) * 2 * noise;
          const i = (y * 256 + x) * 4;
          d[i]     = Math.max(0, Math.min(255, base[0] + k * 255));
          d[i + 1] = Math.max(0, Math.min(255, base[1] + k * 255));
          d[i + 2] = Math.max(0, Math.min(255, base[2] + k * 255));
          d[i + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      // Speckles — tiny dots so the surface reads as gritty, not painted.
      const speck = (color: string, count: number, size: number) => {
        g.fillStyle = color;
        for (let i = 0; i < count; i++) {
          const x = (Math.sin(i * 91.7) * 43758.5453) % 1;
          const y = (Math.sin(i * 53.3 + 17) * 43758.5453) % 1;
          g.fillRect(Math.abs(x) * 256, Math.abs(y) * 256, size, size);
        }
      };
      speck(speckLight, 220, 1);
      speck(speckDark, 140, 1);
      if (seamColor) {
        g.strokeStyle = seamColor;
        g.lineWidth = 1;
        g.globalAlpha = 0.45;
        for (const i of [0, 128]) {
          g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
          g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
        }
        g.globalAlpha = 1;
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return tex;
    };

    // Floor: warm mid-grey concrete — bright enough that dark character
    // silhouettes pop against it, dirty enough not to look like a gallery.
    const floorTex = concrete([95, 92, 86], 0.18, '#b4ada0', '#3d3a35', '#2c2825');
    floorTex.repeat.set(10, 10);
    this.matFloor = new THREE.MeshStandardMaterial({
      map: floorTex, roughness: 0.95, metalness: 0.04,
    });

    // Walls: cooler dark panel — keeps the atmospheric feel but with real
    // surface detail instead of glowy grid lines.
    const wallTex = concrete([46, 52, 62], 0.14, '#8a93a3', '#1a1f28', '#2d3540');
    wallTex.repeat.set(8, 3);
    this.matWall = new THREE.MeshStandardMaterial({
      map: wallTex, roughness: 0.85, metalness: 0.12,
    });

    // Structures (platforms / ramps) keep the old grid look so they read as
    // engineered objects against the natural floor/walls.
    const structTex = grid('#141b27', '#22303f', '#36e0ff');
    structTex.repeat.set(3, 3);
    this.matStruct = new THREE.MeshStandardMaterial({ map: structTex, roughness: 0.8, metalness: 0.15 });

    this.matTrim = new THREE.MeshStandardMaterial({
      color: 0x36e0ff, emissive: 0x36e0ff, emissiveIntensity: 1.4, roughness: 0.4,
    });
  }

  /** Visual box + matching static collider. */
  protected box(
    cx: number, cy: number, cz: number,
    sx: number, sy: number, sz: number,
    mat: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    mesh.position.set(cx, cy, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.colliders.push(this.physics.addStaticBox(cx, cy, cz, sx / 2, sy / 2, sz / 2));
  }

  /** Rotated-box ramp from `start` (bottom) to `end` (top). */
  protected ramp(start: THREE.Vector3, end: THREE.Vector3, width: number) {
    const thickness = 0.7;
    const fwd = end.clone().sub(start).normalize();
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize();
    const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
    const length = end.distanceTo(start);
    const center = start.clone().add(end).multiplyScalar(0.5).addScaledVector(up, -thickness / 2);

    const basis = new THREE.Matrix4().makeBasis(fwd, up, right);
    const quat = new THREE.Quaternion().setFromRotationMatrix(basis);

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, thickness, width), this.matStruct);
    mesh.position.copy(center);
    mesh.quaternion.copy(quat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.colliders.push(this.physics.addStaticBox(
      center.x, center.y, center.z,
      length / 2, thickness / 2, width / 2, quat,
    ));
  }

  /** Glowing trim square around the central platform. */
  protected trimRing(cx: number, cy: number, cz: number, half: number, color: number) {
    const mat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.6, roughness: 0.4,
    });
    const t = 0.25;
    const seg = (sx: number, sz: number, ox: number, oz: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.12, sz), mat);
      m.position.set(cx + ox, cy, cz + oz);
      this.root.add(m);
    };
    seg(half * 2, t, 0, half); seg(half * 2, t, 0, -half);
    seg(t, half * 2, half, 0); seg(t, half * 2, -half, 0);
  }

  protected addJumpPad(footPos: THREE.Vector3, launch: THREE.Vector3) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xff7a18, emissive: 0xff7a18, emissiveIntensity: 1.8, roughness: 0.3,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.0, 0.3, 20), mat);
    mesh.position.set(footPos.x, 0.15, footPos.z);
    this.root.add(mesh);

    const light = new THREE.PointLight(0xff7a18, 6, 10);
    light.position.set(footPos.x, 1.5, footPos.z);
    this.root.add(light);

    this.jumpPads.push({
      pos: new THREE.Vector3(footPos.x, 1.0, footPos.z),
      halfExtents: new THREE.Vector3(2.0, 1.5, 2.0),
      launch: launch.clone(),
      mesh,
    });
  }

  protected buildWaypoints(platformTop: number) {
    const W = (x: number, y: number, z: number) =>
      this.waypoints.push(new THREE.Vector3(x, y, z));

    // outer ring on the floor
    const R = 23;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      W(Math.cos(a) * R, 0, Math.sin(a) * R);
    }
    // ramp bases on the floor
    W(0, 0, 17); W(0, 0, -17); W(17, 0, 0); W(-17, 0, 0);
    // ramp mid-points
    W(0, platformTop / 2, 11.5); W(0, platformTop / 2, -11.5);
    W(11.5, platformTop / 2, 0); W(-11.5, platformTop / 2, 0);
    // central platform top
    W(0, platformTop, 0);
    W(4, platformTop, 4); W(-4, platformTop, -4);
    W(4, platformTop, -4); W(-4, platformTop, 4);

    this.linkWaypoints(21);
  }

  /** Auto-link waypoints within `maxLink` units that have line of sight. */
  protected linkWaypoints(maxLink: number) {
    for (let i = 0; i < this.waypoints.length; i++) this.waypointLinks.push([]);
    for (let i = 0; i < this.waypoints.length; i++) {
      for (let j = i + 1; j < this.waypoints.length; j++) {
        const a = this.waypoints[i];
        const b = this.waypoints[j];
        const d = a.distanceTo(b);
        if (d > maxLink) continue;
        const from = a.clone().setY(a.y + 1.2);
        const dir = b.clone().setY(b.y + 1.2).sub(from);
        const dist = dir.length();
        dir.normalize();
        const hit = this.physics.raycastWorld(from, dir, dist - 0.5);
        if (hit) continue; // blocked
        this.waypointLinks[i].push(j);
        this.waypointLinks[j].push(i);
      }
    }
  }
}
