import * as THREE from 'three';

/**
 * Convert a yaw/pitch aim into a world-space look direction.
 * yaw 0 faces -Z; positive pitch looks up. Shared by the camera, the
 * weapon system and bot aiming so everything agrees on "forward".
 */
export function lookDir(yaw: number, pitch: number, out = new THREE.Vector3()): THREE.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Horizontal forward (ignores pitch) — for movement. */
export function forwardXZ(yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Horizontal right vector for strafing. */
export function rightXZ(yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Randomly perturb `dir` within a cone of the given half-angle (radians). */
export function applySpread(dir: THREE.Vector3, spread: number, out = new THREE.Vector3()): THREE.Vector3 {
  out.copy(dir);
  if (spread <= 0) return out;
  // pick a perpendicular basis
  const up = Math.abs(dir.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3().crossVectors(dir, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(side, dir).normalize();
  const a = Math.random() * Math.PI * 2;
  const r = Math.tan(spread) * Math.sqrt(Math.random());
  out.addScaledVector(side, Math.cos(a) * r).addScaledVector(realUp, Math.sin(a) * r);
  return out.normalize();
}
