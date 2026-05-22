import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Character model loading. Uses "RobotExpressive" — a CC0 rigged + animated
 * model by Tomás Laulhé (modified by Don McCurdy), from the three.js examples.
 * One model is loaded, then cloned per actor with a per-actor colour tint.
 */

export type RobotAnim = 'Idle' | 'Running' | 'Jump' | 'Death';

export interface RobotInstance {
  root: THREE.Group;
  play(name: RobotAnim, fade?: number): void;
  update(dt: number): void;
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
  return {
    root,
    play,
    update: (dt: number) => mixer.update(dt),
  };
}
