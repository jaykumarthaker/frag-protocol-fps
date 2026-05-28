import * as THREE from 'three';
import { WEAPONS } from './Weapons';

/**
 * Procedural weapon models — one detailed, glowing mesh per weapon, built
 * entirely from Three.js primitives (no downloaded assets). The same factory
 * feeds the first-person viewmodel (`Player`) and the third-person held weapon
 * (`Models.RobotInstance`), so a weapon looks identical in every view.
 *
 * Local space: -Z is the muzzle direction, +Y is up, the grip sits near the
 * origin. `userData.muzzle` is an empty at the barrel tip; `userData.animate`
 * drives cheap idle motion (spinning coils, pulsing cores, overheat glow).
 */

export type WeaponMesh = THREE.Group & {
  userData: {
    animate: (time: number, firing: number) => void;
    muzzle: THREE.Object3D;
  };
};

const HALF_PI = Math.PI / 2;

function metal(color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

/** A bloom-friendly emissive trim material in the weapon's theme colour. */
function accentMat(color: number, intensity = 1.25): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity,
    metalness: 0.3, roughness: 0.25,
  });
}

/** An unlit, near-white core that blooms hard — for energy cells / plasma. */
function coreMat(color: number): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45);
  return new THREE.MeshBasicMaterial({ color: c });
}

/** Build a fresh, animated weapon model for the given weapon id. */
export function createWeaponMesh(id: string): WeaponMesh {
  const def = WEAPONS[id];
  const color = def ? def.color : 0x9aa7bd;
  const accent = def ? def.accent : 0xffffff;
  const g = new THREE.Group() as WeaponMesh;

  const dark = metal(0x10141d, 0.9, 0.36);
  const mid = metal(0x29384a, 0.78, 0.42);
  const steel = metal(0x5d6f86, 0.88, 0.3);

  const part = (
    geo: THREE.BufferGeometry, material: THREE.Material,
    x: number, y: number, z: number, rx = 0, ry = 0, rz = 0,
  ): THREE.Mesh => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
    return mesh;
  };

  // --- shared grip + trigger guard ---
  part(new THREE.BoxGeometry(0.085, 0.2, 0.12), dark, 0, -0.14, 0.15, 0.2);
  part(new THREE.TorusGeometry(0.046, 0.013, 6, 14), dark, 0, -0.04, 0.09, HALF_PI);

  let animate: (time: number, firing: number) => void = () => {};
  const muzzle = new THREE.Object3D();

  switch (id) {
    case 'railgun': {
      // long, thin, surgical — a barrel ringed with accelerator coils
      part(new THREE.BoxGeometry(0.1, 0.13, 0.46), mid, 0, 0, -0.02);
      part(new THREE.BoxGeometry(0.066, 0.05, 0.52), dark, 0, 0.085, -0.05);
      part(new THREE.BoxGeometry(0.11, 0.05, 0.12), dark, 0, -0.02, 0.2); // breech block
      part(new THREE.BoxGeometry(0.05, 0.07, 0.05), coreMat(color), 0, 0.02, 0.2); // energy cell
      // scope — body in primary, lens glows in accent (white)
      part(new THREE.CylinderGeometry(0.034, 0.034, 0.17, 12), dark, 0, 0.135, 0.0, HALF_PI);
      part(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 12), accentMat(accent, 1.8), 0, 0.135, 0.09, HALF_PI);
      // barrel
      part(new THREE.CylinderGeometry(0.027, 0.03, 0.74, 14), steel, 0, 0.0, -0.42, HALF_PI);
      // side rails — accent (white) trim against the cyan coils
      part(new THREE.BoxGeometry(0.022, 0.03, 0.6), accentMat(accent, 1.0), -0.06, 0.0, -0.12);
      part(new THREE.BoxGeometry(0.022, 0.03, 0.6), accentMat(accent, 1.0), 0.06, 0.0, -0.12);
      // magnetic accelerator coils
      const coilMats: THREE.MeshStandardMaterial[] = [];
      for (let i = 0; i < 5; i++) {
        const cm = accentMat(color, 1.0);
        coilMats.push(cm);
        part(new THREE.TorusGeometry(0.06, 0.019, 8, 20), cm, 0, 0.0, -0.13 - i * 0.13);
      }
      part(new THREE.TorusGeometry(0.05, 0.016, 8, 20), accentMat(color, 1.5), 0, 0.0, -0.78);
      muzzle.position.set(0, 0, -0.84);
      animate = (t, f) => {
        for (let i = 0; i < coilMats.length; i++) {
          coilMats[i].emissiveIntensity = 0.9 + Math.sin(t * 5 - i * 0.9) * 0.55 + f * 1.8;
        }
      };
      break;
    }

    case 'shard': {
      // wide, chunky, aggressive — barrel cluster + raw crystal magazine
      part(new THREE.BoxGeometry(0.24, 0.17, 0.34), mid, 0, 0, -0.02);
      part(new THREE.BoxGeometry(0.27, 0.21, 0.12), dark, 0, 0, -0.22);
      part(new THREE.BoxGeometry(0.28, 0.045, 0.3), accentMat(accent, 1.1), 0, 0.105, -0.04);
      // four stubby barrels
      for (const sx of [-0.072, 0.072]) {
        for (const sy of [-0.05, 0.05]) {
          part(new THREE.CylinderGeometry(0.045, 0.05, 0.36, 12), dark, sx, sy, -0.34, HALF_PI);
        }
      }
      // raw crystal magazine
      const crystalMat = accentMat(color, 1.3);
      const crystal = part(new THREE.IcosahedronGeometry(0.1, 0), crystalMat, 0, 0.18, 0.02);
      part(new THREE.IcosahedronGeometry(0.05, 0), coreMat(color), 0, 0.18, 0.02);
      // jagged side shards — accent (emerald) so they pop against the amber body
      part(new THREE.OctahedronGeometry(0.055, 0), accentMat(accent, 1.3), -0.15, 0.02, -0.05, 0.5, 0, 0.4);
      part(new THREE.OctahedronGeometry(0.055, 0), accentMat(accent, 1.3), 0.15, 0.02, -0.05, -0.5, 0, -0.4);
      muzzle.position.set(0, 0, -0.54);
      animate = (t, f) => {
        crystal.rotation.y = t * 0.9;
        crystal.rotation.x = t * 0.5;
        crystalMat.emissiveIntensity = 1.0 + Math.sin(t * 13) * 0.35 + f * 1.2;
      };
      break;
    }

    case 'rocket': {
      // fat tube, theatrical — a 3-barrel revolver cluster + glowing warhead
      part(new THREE.CylinderGeometry(0.12, 0.12, 0.56, 18), mid, 0, 0.03, -0.1, HALF_PI);
      part(new THREE.CylinderGeometry(0.105, 0.105, 0.58, 18, 1, true), dark, 0, 0.03, -0.1, HALF_PI);
      part(new THREE.CylinderGeometry(0.13, 0.115, 0.06, 18), dark, 0, 0.03, 0.2, HALF_PI); // rear cap
      part(new THREE.BoxGeometry(0.16, 0.06, 0.16), dark, 0, -0.05, 0.26); // shoulder rest
      // heat-vent fins
      for (let i = 0; i < 3; i++) {
        part(new THREE.BoxGeometry(0.04, 0.07, 0.18), accentMat(color, 0.9), 0, 0.16, -0.05 - i * 0.13);
      }
      // side accent conduits — crimson stripe down the orange tube
      part(new THREE.BoxGeometry(0.03, 0.04, 0.4), accentMat(accent, 1.2), -0.12, 0.03, -0.1);
      part(new THREE.BoxGeometry(0.03, 0.04, 0.4), accentMat(accent, 1.2), 0.12, 0.03, -0.1);
      // 3-barrel revolver cluster
      part(new THREE.CylinderGeometry(0.135, 0.135, 0.12, 18), dark, 0, 0.03, -0.42, HALF_PI);
      const whMat = accentMat(color, 1.2);
      for (let i = 0; i < 3; i++) {
        const a = i * (Math.PI * 2 / 3) - HALF_PI;
        const bx = Math.cos(a) * 0.07;
        const by = 0.03 + Math.sin(a) * 0.07;
        part(new THREE.CylinderGeometry(0.052, 0.052, 0.16, 12), mid, bx, by, -0.46, HALF_PI);
        // a live warhead loaded in each barrel
        part(new THREE.ConeGeometry(0.04, 0.11, 12), whMat, bx, by, -0.52, -HALF_PI);
      }
      part(new THREE.BoxGeometry(0.05, 0.05, 0.1), dark, 0, 0.17, 0.04); // sight
      part(new THREE.BoxGeometry(0.03, 0.02, 0.03), coreMat(color), 0, 0.2, 0.04);
      muzzle.position.set(0, 0.03, -0.58);
      animate = (t, f) => {
        whMat.emissiveIntensity = 1.0 + Math.sin(t * 4) * 0.5 + f * 1.4;
      };
      break;
    }

    case 'pulse':
    default: {
      // energetic, unstable — plasma core + rotating accelerator rings
      part(new THREE.BoxGeometry(0.12, 0.15, 0.42), mid, 0, 0, -0.04);
      part(new THREE.BoxGeometry(0.09, 0.06, 0.34), dark, 0, 0.09, -0.06); // top shroud
      part(new THREE.CylinderGeometry(0.04, 0.04, 0.46, 14), steel, 0, 0.03, -0.32, HALF_PI); // barrel
      // plasma core
      const coreInner = part(new THREE.SphereGeometry(0.075, 18, 14), coreMat(color), 0, 0.055, 0.09);
      const shellMat = accentMat(color, 1.0);
      part(new THREE.SphereGeometry(0.092, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.6), shellMat, 0, 0.055, 0.09);
      // rotating accelerator rings around the barrel
      const ring1 = part(new THREE.TorusGeometry(0.082, 0.022, 8, 20), accentMat(color, 1.2), 0, 0.03, -0.26);
      const ring2 = part(new THREE.TorusGeometry(0.07, 0.02, 8, 20), accentMat(color, 1.2), 0, 0.03, -0.42);
      // emissive conduits + heat fins — magenta accent against the violet body
      part(new THREE.BoxGeometry(0.024, 0.03, 0.36), accentMat(accent, 1.2), -0.066, 0.0, -0.04);
      part(new THREE.BoxGeometry(0.024, 0.03, 0.36), accentMat(accent, 1.2), 0.066, 0.0, -0.04);
      for (let i = 0; i < 4; i++) {
        part(new THREE.BoxGeometry(0.11, 0.035, 0.022), accentMat(color, 0.85), 0, 0.12, 0.02 - i * 0.07);
      }
      part(new THREE.ConeGeometry(0.045, 0.09, 14), accentMat(color, 1.4), 0, 0.03, -0.56, -HALF_PI);
      muzzle.position.set(0, 0.03, -0.62);
      animate = (t, f) => {
        ring1.rotation.z = t * 5;
        ring2.rotation.z = -t * 4;
        const pulse = 1 + Math.sin(t * 9) * 0.12 + f * 0.5;
        coreInner.scale.setScalar(pulse);
        shellMat.emissiveIntensity = 0.9 + Math.sin(t * 9) * 0.3 + f * 1.6;
      };
      break;
    }
  }

  g.add(muzzle);
  g.userData.animate = animate;
  g.userData.muzzle = muzzle;
  return g;
}

/** Free every geometry/material under a weapon mesh (used on weapon swap). */
export function disposeWeaponMesh(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
  });
}
