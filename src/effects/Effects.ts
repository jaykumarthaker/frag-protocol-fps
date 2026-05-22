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

  /** Explosion: expanding additive shell + fading point light. */
  explosion(pos: THREE.Vector3, radius: number, color: number) {
    const geo = new THREE.SphereGeometry(1, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const shell = new THREE.Mesh(geo, mat);
    shell.position.copy(pos);

    const light = new THREE.PointLight(color, 40, radius * 4);
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
        light.intensity = 40 * (1 - k);
      },
      cleanup: () => { geo.dispose(); mat.dispose(); },
    });

    // Debris sparks.
    const sparkMat = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks: { m: THREE.Mesh; v: THREE.Vector3 }[] = [];
    for (let i = 0; i < 12; i++) {
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
