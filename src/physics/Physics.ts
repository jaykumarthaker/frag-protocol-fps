import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/**
 * Thin wrapper around the Rapier physics world.
 *
 * Design: world geometry is static cuboid colliders; actors are
 * kinematic-position capsules driven by one shared KinematicCharacterController.
 * Projectiles and combat hitscan are resolved with raycasts — actor capsules
 * are tagged so world rays can ignore them (actor hits are done in JS for
 * precise per-body-part headshot detection).
 */
export class Physics {
  world!: RAPIER.World;
  controller!: RAPIER.KinematicCharacterController;

  /** Collider handles that belong to actors (so world rays can skip them). */
  private actorColliders = new Set<number>();

  static async create(): Promise<Physics> {
    await RAPIER.init();
    const p = new Physics();
    p.world = new RAPIER.World({ x: 0, y: -55, z: 0 });
    p.world.timestep = 1 / 60;

    const c = p.world.createCharacterController(0.02);
    c.enableAutostep(0.5, 0.25, true);
    c.enableSnapToGround(0.5);
    c.setMaxSlopeClimbAngle((58 * Math.PI) / 180);
    c.setMinSlopeSlideAngle((48 * Math.PI) / 180);
    c.setApplyImpulsesToDynamicBodies(false);
    c.setSlideEnabled(true);
    p.controller = c;
    return p;
  }

  /** Add a static box collider centred at (cx,cy,cz) with half-extents h*. */
  addStaticBox(
    cx: number, cy: number, cz: number,
    hx: number, hy: number, hz: number,
    quat?: THREE.Quaternion,
  ): RAPIER.Collider {
    let desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz);
    if (quat) desc = desc.setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
    return this.world.createCollider(desc);
  }

  /** Create a kinematic capsule body+collider for an actor. */
  addActorCapsule(pos: THREE.Vector3, halfHeight: number, radius: number) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z),
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius),
      body,
    );
    this.actorColliders.add(collider.handle);
    return { body, collider };
  }

  removeActor(body: RAPIER.RigidBody, collider: RAPIER.Collider) {
    this.actorColliders.delete(collider.handle);
    this.world.removeRigidBody(body);
  }

  /**
   * Cast a ray against world geometry only (skips actor capsules).
   * Returns time-of-impact along `dir` and the surface normal, or null.
   */
  raycastWorld(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    maxDist: number,
  ): { toi: number; normal: THREE.Vector3 } | null {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(
      ray, maxDist, true,
      undefined, undefined, undefined, undefined,
      (c) => !this.actorColliders.has(c.handle),
    );
    if (!hit) return null;
    return {
      toi: hit.timeOfImpact,
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    };
  }

  step() {
    this.world.step();
  }
}
