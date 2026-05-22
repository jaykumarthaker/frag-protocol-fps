import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createWeaponMesh, disposeWeaponMesh, type WeaponMesh } from '../weapons/WeaponModels';

/**
 * Character model loading. Uses "RobotExpressive" — a CC0 rigged + animated
 * model by Tomás Laulhé (modified by Don McCurdy), from the three.js examples.
 * One model is loaded, then cloned per actor with a per-actor colour tint.
 *
 * Each robot also carries a procedural weapon model: it is parented to the
 * robot's root and re-seated on the right hand bone every frame, so the
 * character is visibly holding the gun it has equipped.
 */

export type RobotAnim = 'Idle' | 'Running' | 'Jump' | 'Death';

export interface RobotInstance {
  root: THREE.Group;
  play(name: RobotAnim, fade?: number): void;
  update(dt: number): void;
  /** Show the given weapon in the robot's hand (no-op if unchanged). */
  setWeapon(id: string): void;
}

const TARGET_HEIGHT = 1.78;

let template: THREE.Group | null = null;
let clips: THREE.AnimationClip[] = [];
let fitScale = 1;

/** Load the character model. Call once before creating any actors. */
export async function loadModels(baseUrl: string): Promise<void> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(baseUrl + 'models/RobotExpressive.glb');
  template = gltf.scene as unknown as THREE.Group;
  clips = gltf.animations;
  const box = new THREE.Box3().setFromObject(template);
  fitScale = TARGET_HEIGHT / (box.max.y - box.min.y);
}

/** Create an independent animated robot tinted toward `colorHex`. */
export function createRobot(colorHex: number): RobotInstance {
  if (!template) throw new Error('Models.loadModels() has not finished');

  const root = cloneSkeleton(template) as THREE.Group;
  root.scale.setScalar(fitScale);

  const tint = new THREE.Color(colorHex);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    const src = mesh.material as THREE.MeshStandardMaterial;
    if (src && src.isMeshStandardMaterial) {
      const m = src.clone();
      m.color.lerp(tint, 0.4);
      m.emissive = tint.clone();
      m.emissiveIntensity = 0.3;
      mesh.material = m;
    }
  });

  // Find the right-hand bone so the held weapon tracks the hand animation.
  let handBone: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (handBone || !(o as THREE.Bone).isBone) return;
    const n = o.name.toLowerCase();
    if (n.includes('hand') && /(right|_r\b|\br$|\.r$|rhand)/.test(n)) handBone = o;
  });
  if (!handBone) {
    root.traverse((o) => {
      if (!handBone && (o as THREE.Bone).isBone && o.name.toLowerCase().includes('hand')) {
        handBone = o;
      }
    });
  }

  // A held-weapon anchor parented to the root: keeps a fixed, body-aligned
  // orientation (the weapon model points -Z, the robot faces +Z in root
  // space) while its position is re-synced to the hand bone each frame.
  const weaponAnchor = new THREE.Group();
  weaponAnchor.rotation.y = Math.PI;
  weaponAnchor.scale.setScalar(1 / fitScale);
  if (!handBone) weaponAnchor.position.set(0.3 / fitScale, 1.18 / fitScale, 0.12 / fitScale);
  root.add(weaponAnchor);

  const mixer = new THREE.AnimationMixer(root);
  const actions: Partial<Record<RobotAnim, THREE.AnimationAction>> = {};
  for (const name of ['Idle', 'Running', 'Jump', 'Death'] as RobotAnim[]) {
    const clip = THREE.AnimationClip.findByName(clips, name);
    if (clip) actions[name] = mixer.clipAction(clip);
  }

  let current: RobotAnim | null = null;
  const play = (name: RobotAnim, fade = 0.22) => {
    if (current === name) return;
    const next = actions[name];
    if (!next) return;
    const prev = current ? actions[current] : null;
    next.reset();
    if (name === 'Jump' || name === 'Death') {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
    }
    next.fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    current = name;
  };

  play('Idle', 0);

  let weaponId: string | null = null;
  let weaponMesh: WeaponMesh | null = null;
  const setWeapon = (id: string) => {
    if (id === weaponId) return;
    weaponId = id;
    if (weaponMesh) {
      weaponAnchor.remove(weaponMesh);
      disposeWeaponMesh(weaponMesh);
    }
    weaponMesh = createWeaponMesh(id);
    // seat the grip at the anchor origin (≈ the hand)
    weaponMesh.position.set(0, 0.14, -0.15);
    weaponAnchor.add(weaponMesh);
  };

  const handWorld = new THREE.Vector3();
  let clock = 0;

  return {
    root,
    play,
    setWeapon,
    update: (dt: number) => {
      mixer.update(dt);
      clock += dt;
      if (handBone) {
        (handBone as THREE.Object3D).getWorldPosition(handWorld);
        root.worldToLocal(handWorld);
        weaponAnchor.position.copy(handWorld);
      }
      if (weaponMesh) weaponMesh.userData.animate(clock, 0);
    },
  };
}
