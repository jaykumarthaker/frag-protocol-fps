import * as THREE from 'three';

interface Effect {
  obj: THREE.Object3D;
  life: number;
  maxLife: number;
  tick: (e: Effect, dt: number) => void;
  cleanup?: () => void;
}

/**
 * Lightweight transient visual effects: tracers, beams, muzzle flashes,
 * impact bursts and explosions. Each effect is a short-lived Object3D added
 * to the scene and removed when its life expires.
 */
export class Effects {
  private scene: THREE.Scene;
  private active: Effect[] = [];

  // Shared geometries/materials reused across effects.
  private sparkGeo = new THREE.SphereGeometry(0.07, 6, 4);
  private ringGeo = new THREE.RingGeometry(0.2, 0.32, 18);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.life -= dt;
      e.tick(e, dt);
      if (e.life <= 0) {
        this.scene.remove(e.obj);
        e.cleanup?.();
        this.active.splice(i, 1);
      }
    }
  }

  private add(e: Effect) {
    this.scene.add(e.obj);
    this.active.push(e);
  }

  private disposeMesh(o: THREE.Object3D) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry && m.geometry !== this.sparkGeo && m.geometry !== this.ringGeo) {
        m.geometry.dispose();
      }
      const mat = (m as any).material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x: THREE.Material) => x.dispose());
    });
  }

  /** Thin fast-fading line from `a` to `b` — bullet/pellet tracer. */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color: number) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const line = new THREE.Line(geo, mat);
    this.add({
      obj: line, life: 0.07, maxLife: 0.07,
      tick: (e) => { mat.opacity = 0.9 * (e.life / e.maxLife); },
      cleanup: () => { geo.dispose(); mat.dispose(); },
    });
  }

  /** Thick glowing beam (railgun slug trail / pulse beam). */
  beam(a: THREE.Vector3, b: THREE.Vector3, color: number, radius = 0.08, life = 0.16) {
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(radius, radius, len, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    );
    this.add({
      obj: mesh, life, maxLife: life,
      tick: (e) => {
        const k = e.life / e.maxLife;
        mat.opacity = 0.85 * k;
        mesh.scale.set(0.4 + 0.6 * k, 1, 0.4 + 0.6 * k);
      },
      cleanup: () => { geo.dispose(); mat.dispose(); },
    });
  }

  /** Expanding additive ring at a muzzle, oriented along the shot. */
  muzzleRing(pos: THREE.Vector3, dir: THREE.Vector3, color: number) {
    const geo = new THREE.RingGeometry(0.12, 0.2, 22);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.copy(pos);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize());
    this.add({
      obj: ring, life: 0.18, maxLife: 0.18,
      tick: (e) => {
        const k = 1 - e.life / e.maxLife;
        ring.scale.setScalar(0.5 + k * 3.4);
        mat.opacity = 0.9 * (1 - k);
      },
      cleanup: () => { geo.dispose(); mat.dispose(); },
    });
  }

  /** A soft, drifting puff — rocket exhaust / lingering smoke. */
  puff(pos: THREE.Vector3, color: number, size = 0.5, life = 0.5) {
    const mat = new THREE.SpriteMaterial({
      color, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const spr = new THREE.Sprite(mat);
    spr.position.copy(pos);
    spr.scale.setScalar(size);
    this.add({
      obj: spr, life, maxLife: life,
      tick: (e, dt) => {
        const k = e.life / e.maxLife;
        mat.opacity = 0.5 * k;
        spr.scale.setScalar(size * (1 + (1 - k) * 1.6));
        spr.position.y += dt * 0.4;
      },
      cleanup: () => mat.dispose(),
    });
  }

  /** Brief additive flash at a muzzle / spawn point. */
  flash(pos: THREE.Vector3, color: number, size = 0.6, life = 0.06) {
    const mat = new THREE.SpriteMaterial({
      color, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const spr = new THREE.Sprite(mat);
    spr.position.copy(pos);
    spr.scale.setScalar(size);
    this.add({
      obj: spr, life, maxLife: life,
      tick: (e) => { mat.opacity = e.life / e.maxLife; },
      cleanup: () => mat.dispose(),
    });
  }

  /** Impact burst: an expanding ring + a few sparks. */
  impact(pos: THREE.Vector3, normal: THREE.Vector3, color: number) {
    const group = new THREE.Group();
    group.position.copy(pos).addScaledVector(normal, 0.02);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    const ringMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    group.add(ring);

    const sparkMat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this.sparkGeo, sparkMat);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2,
      ).normalize().multiplyScalar(4 + Math.random() * 4);
      sparks.push({ m, v });
      this.scene.add(m);
      m.position.copy(pos);
    }
    this.add({
      obj: group, life: 0.35, maxLife: 0.35,
      tick: (e, dt) => {
        const k = 1 - e.life / e.maxLife;
        ring.scale.setScalar(1 + k * 3);
        ringMat.opacity = 0.9 * (1 - k);
        for (const s of sparks) {
          s.v.y -= 22 * dt;
          s.m.position.addScaledVector(s.v, dt);
        }
      },
      cleanup: () => {
        ringMat.dispose();
        for (const s of sparks) this.scene.remove(s.m);
        sparkMat.dispose();
      },
    });
  }

  /**
   * Blood spray when a shot connects with an enemy — a cone of dark-red
   * droplets thrown along the shot direction plus a quick red mist puff. This
   * is the "you hit them" feedback (PUBG-style): non-additive deep red so it
   * reads as blood rather than another glowing energy burst. Spray volume
   * scales with the damage dealt.
   */
  blood(pos: THREE.Vector3, dir: THREE.Vector3, amount = 30) {
    const n = THREE.MathUtils.clamp(Math.round(4 + amount * 0.1), 5, 12);
    const spray = dir.lengthSq() > 1e-6
      ? dir.clone().normalize()
      : new THREE.Vector3(0, 1, 0);

    // Droplets: spheres flung in a cone around the spray direction, pulled
    // down by gravity and shrinking as they fade.
    const dropMat = new THREE.MeshBasicMaterial({ color: 0x9b0a0a });
    const drops: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sparkGeo, dropMat);
      m.position.copy(pos);
      const v = spray.clone()
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 1.1,
          (Math.random() - 0.5) * 1.1 + 0.25,
          (Math.random() - 0.5) * 1.1,
        ))
        .normalize()
        .multiplyScalar(5 + Math.random() * 7);
      drops.push({ m, v });
      this.scene.add(m);
    }
    this.add({
      obj: new THREE.Group(), life: 0.45, maxLife: 0.45,
      tick: (e, dt) => {
        const k = e.life / e.maxLife;
        for (const d of drops) {
          d.v.y -= 30 * dt;
          d.m.position.addScaledVector(d.v, dt);
          d.m.scale.setScalar(Math.max(0.05, k));
        }
      },
      cleanup: () => {
        for (const d of drops) this.scene.remove(d.m);
        dropMat.dispose();
      },
    });

    // A short-lived red mist at the impact point.
    const mistMat = new THREE.SpriteMaterial({
      color: 0xb71414, transparent: true, opacity: 0.85, depthWrite: false,
    });
    const mist = new THREE.Sprite(mistMat);
    mist.position.copy(pos);
    mist.scale.setScalar(0.5);
    this.add({
      obj: mist, life: 0.28, maxLife: 0.28,
      tick: (e) => {
        const k = 1 - e.life / e.maxLife;
        mist.scale.setScalar(0.5 + k * 1.6);
        mistMat.opacity = 0.85 * (1 - k);
      },
      cleanup: () => mistMat.dispose(),
    });
  }

  /** Explosion: expanding additive shell + shockwave ring + fading light. */
  explosion(pos: THREE.Vector3, radius: number, color: number) {
    const big = radius > 3;
    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const shell = new THREE.Mesh(geo, mat);
    shell.position.copy(pos);

    const peakLight = big ? 70 : 40;
    const light = new THREE.PointLight(color, peakLight, radius * 4.5);
    light.position.copy(pos);

    const group = new THREE.Group();
    group.add(shell);
    group.add(light);

    this.add({
      obj: group, life: 0.45, maxLife: 0.45,
      tick: (e) => {
        const k = 1 - e.life / e.maxLife;
        shell.scale.setScalar(0.3 + k * radius);
        mat.opacity = 0.85 * (1 - k);
        light.intensity = peakLight * (1 - k);
      },
      cleanup: () => { geo.dispose(); mat.dispose(); },
    });

    // A flat shockwave ring punching outward along the ground plane.
    if (big) {
      const waveGeo = new THREE.RingGeometry(0.5, 0.8, 28);
      const waveMat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const wave = new THREE.Mesh(waveGeo, waveMat);
      wave.rotation.x = -Math.PI / 2;
      wave.position.copy(pos).setY(pos.y - radius * 0.3 + 0.1);
      this.add({
        obj: wave, life: 0.5, maxLife: 0.5,
        tick: (e) => {
          const k = 1 - e.life / e.maxLife;
          wave.scale.setScalar(0.4 + k * radius * 1.7);
          waveMat.opacity = 0.7 * (1 - k);
        },
        cleanup: () => { waveGeo.dispose(); waveMat.dispose(); },
      });
    }

    // Debris sparks — denser for big blasts.
    const sparkMat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparkCount = Math.min(30, Math.round(10 + radius * 2.6));
    const sparks: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    for (let i = 0; i < sparkCount; i++) {
      const m = new THREE.Mesh(this.sparkGeo, sparkMat);
      m.position.copy(pos);
      const v = new THREE.Vector3(
        Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5,
      ).normalize().multiplyScalar(8 + Math.random() * 10);
      sparks.push({ m, v });
      this.scene.add(m);
    }
    this.add({
      obj: new THREE.Group(), life: 0.7, maxLife: 0.7,
      tick: (_e, dt) => {
        for (const s of sparks) {
          s.v.y -= 26 * dt;
          s.m.position.addScaledVector(s.v, dt);
        }
      },
      cleanup: () => {
        for (const s of sparks) this.scene.remove(s.m);
        sparkMat.dispose();
      },
    });
  }
}
