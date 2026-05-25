import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createWeaponMesh, disposeWeaponMesh, type WeaponMesh } from '../weapons/WeaponModels';

/**
 * Character model registry. Multiple rigged GLB characters can be plugged in
 * (Quaternius "Ultimate Animated Character Pack" — CC0 — is the intended
 * source; drop files into `public/models/characters/` and they appear in the
 * character-select screen). Each character is loaded lazily on first use and
 * cached. If a file is missing the loader falls back to the bundled robot,
 * so the game always boots even with no extra assets installed.
 *
 * The four logical animations (`Idle`, `Running`, `Jump`, `Death`) are
 * resolved against each character's clip names through `clipAliases`, which
 * lets packs with different naming conventions plug in without code changes.
 */

export type CharacterAnim = 'Idle' | 'Running' | 'Jump' | 'Death';
export type RobotAnim = CharacterAnim; // legacy alias kept for the call sites

export interface CharacterDef {
  id: string;
  name: string;
  description: string;
  /** Path relative to BASE_URL — e.g. `models/characters/Soldier.glb`. */
  file: string;
  /** Multiplicative tweak when a model is shipped at an unusual scale. */
  scaleBoost?: number;
  /** When set, only this fraction of the model's colour is tinted toward the
   *  team / player colour (some packs already have strong materials). */
  tintStrength?: number;
}

export interface CharacterInstance {
  root: THREE.Group;
  play(name: CharacterAnim, fade?: number): void;
  update(dt: number): void;
  setWeapon(id: string): void;
}

// Larger-than-life arena-shooter scale. Bigger maps mean players read better
// at size, and headshots are slightly easier to land at long range — both
// match the UT-genre target feel. The current roster is rendered extra-big
// so the characters read clearly across the larger Cash Raid map.
const TARGET_HEIGHT = 3.3;

/**
 * Character roster. Order is the order shown in the character-select screen.
 * `robot` is the bundled default and is always present; the rest are expected
 * Quaternius pack filenames — if a file is missing the entry falls back to
 * the robot so nothing crashes.
 */
export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: 'robot',
    name: 'Sentinel',
    description: 'Standard-issue arena combatant. Reliable and balanced.',
    file: 'models/RobotExpressive.glb',
  },
  {
    id: 'george',
    name: 'George',
    description: 'Steady aim, steadier nerves.',
    file: 'models/characters/George.gltf',
  },
  {
    id: 'leela',
    name: 'Leela',
    description: 'Quick on the draw, quicker on the kill.',
    file: 'models/characters/Leela.gltf',
  },
  {
    id: 'mike',
    name: 'Mike',
    description: 'Heavy hitter with no off switch.',
    file: 'models/characters/Mike.gltf',
  },
  {
    id: 'stan',
    name: 'Stan',
    description: 'Cold operator. Colder shot.',
    file: 'models/characters/Stan.gltf',
  },
];

export const DEFAULT_CHARACTER_ID = 'robot';

interface LoadedChar {
  def: CharacterDef;
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
  fitScale: number;
  /** Resolved actual filepath that loaded (may be the fallback). */
  loadedFrom: string;
}

const cache = new Map<string, LoadedChar>();
const pending = new Map<string, Promise<LoadedChar>>();
const loader = new GLTFLoader();

let baseUrl = '';
let fallback: LoadedChar | null = null;

/** Initialise the loader and pre-load the default character. */
export async function loadModels(url: string): Promise<void> {
  baseUrl = url;
  fallback = await loadDef(getCharacter(DEFAULT_CHARACTER_ID));
  cache.set(DEFAULT_CHARACTER_ID, fallback);
}

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** Load a character (cached). Falls back to the default on any failure. */
export async function loadCharacter(id: string): Promise<void> {
  if (cache.has(id)) return;
  const existing = pending.get(id);
  if (existing) { await existing; return; }
  const def = getCharacter(id);
  const p = loadDef(def)
    .then((lc) => { cache.set(id, lc); pending.delete(id); return lc; })
    .catch((err) => {
      pending.delete(id);
      console.warn(`[Models] '${id}' (${def.file}) failed to load — using fallback`, err);
      if (fallback) cache.set(id, fallback);
      return fallback as LoadedChar;
    });
  pending.set(id, p);
  await p;
}

async function loadDef(def: CharacterDef): Promise<LoadedChar> {
  const gltf = await loader.loadAsync(baseUrl + def.file);
  const scene = gltf.scene as unknown as THREE.Group;
  const box = new THREE.Box3().setFromObject(scene);
  const h = Math.max(0.01, box.max.y - box.min.y);
  return {
    def,
    scene,
    clips: gltf.animations,
    fitScale: (TARGET_HEIGHT / h) * (def.scaleBoost ?? 1),
    loadedFrom: def.file,
  };
}

/** True if the GLB file actually loaded (false → using the robot fallback). */
export function isCharacterAvailable(id: string): boolean {
  const lc = cache.get(id);
  return !!lc && lc.def.id === id;
}

/** Match a logical animation name against a character's clip list, trying
 *  the most common naming conventions in the GLB ecosystem. */
function findClip(clips: THREE.AnimationClip[], anim: CharacterAnim): THREE.AnimationClip | undefined {
  const aliases: Record<CharacterAnim, string[]> = {
    Idle: ['Idle', 'idle', 'CharacterArmature|Idle', 'Armature|Idle', 'Idle_Loop'],
    Running: ['Running', 'Run', 'run', 'CharacterArmature|Run', 'Armature|Run',
      'Walk', 'CharacterArmature|Walk', 'Run_Loop'],
    Jump: ['Jump', 'CharacterArmature|Jump', 'Armature|Jump', 'Jump_Idle', 'Jump_Up'],
    Death: ['Death', 'Die', 'CharacterArmature|Death', 'Armature|Death', 'Dying'],
  };
  for (const name of aliases[anim]) {
    const c = THREE.AnimationClip.findByName(clips, name);
    if (c) return c;
  }
  // last-ditch: substring match
  const lower = anim.toLowerCase();
  return clips.find((c) => c.name.toLowerCase().includes(lower));
}

/** Find the right-hand bone for parenting a held weapon. Different packs name
 *  it differently — Mixamo/Three.js use `Hand.R`/`RightHand`, Quaternius uses
 *  `Fist.R`, so we look for either keyword plus a right-side suffix. */
function findRightHand(root: THREE.Object3D): THREE.Object3D | null {
  const isBone = (o: THREE.Object3D) => (o as THREE.Bone).isBone;
  const rightSide = /(right|_r\b|\br$|\.r$|rhand)/;
  let hand: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (hand || !isBone(o)) return;
    const n = o.name.toLowerCase();
    if ((n.includes('hand') || n.includes('fist')) && rightSide.test(n)) hand = o;
  });
  if (!hand) {
    root.traverse((o) => {
      if (hand || !isBone(o)) return;
      const n = o.name.toLowerCase();
      if (n.includes('hand') || n.includes('fist')) hand = o;
    });
  }
  return hand;
}

/** Create an independent animated character. Team / player colour is shown
 *  externally (halo ring + name tag) — the model itself keeps its original
 *  materials and textures so each character reads as visually distinct.
 *  `castShadow` lets the caller opt out for non-player actors on the
 *  fast quality tier (skinned-mesh shadows are the single biggest GPU cost). */
export function createCharacter(
  id: string, _colorHex: number, castShadow = true,
): CharacterInstance {
  let lc = cache.get(id) ?? fallback;
  if (!lc) throw new Error('Models.loadModels() has not finished');

  const root = cloneSkeleton(lc.scene) as THREE.Group;
  root.scale.setScalar(lc.fitScale);

  // Re-use the source materials across all clones of the same character —
  // we no longer recolour per-actor, so a shared material lets Three.js
  // batch draw calls and saves the per-instance material clone.
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = castShadow;
  });

  const handBone = findRightHand(root);

  const weaponAnchor = new THREE.Group();
  weaponAnchor.rotation.y = Math.PI;
  weaponAnchor.scale.setScalar(1 / lc.fitScale);
  if (!handBone) weaponAnchor.position.set(0.3 / lc.fitScale, 1.18 / lc.fitScale, 0.12 / lc.fitScale);
  root.add(weaponAnchor);

  const mixer = new THREE.AnimationMixer(root);
  const actions: Partial<Record<CharacterAnim, THREE.AnimationAction>> = {};
  for (const name of ['Idle', 'Running', 'Jump', 'Death'] as CharacterAnim[]) {
    const clip = findClip(lc.clips, name);
    if (clip) actions[name] = mixer.clipAction(clip);
  }

  let current: CharacterAnim | null = null;
  const play = (name: CharacterAnim, fade = 0.22) => {
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
  const setWeapon = (id2: string) => {
    if (id2 === weaponId) return;
    weaponId = id2;
    if (weaponMesh) {
      weaponAnchor.remove(weaponMesh);
      disposeWeaponMesh(weaponMesh);
    }
    weaponMesh = createWeaponMesh(id2);
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

/**
 * A glowing ring that sits at the actor's feet, coloured to identify the
 * player / team. Replaces the old per-character colour tint as the "who's on
 * which side" visual. Add it to an actor's `mesh` (Group) and it tracks the
 * actor automatically.
 */
export function createHalo(colorHex: number): THREE.Group {
  const grp = new THREE.Group();
  // Bright outer ring (the team band).
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.06, 10, 32),
    new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.95 }),
  );
  ring.rotation.x = Math.PI / 2;
  grp.add(ring);
  // Soft inner disc to give it a "spotlight" feel against the floor.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 32),
    new THREE.MeshBasicMaterial({
      color: colorHex, transparent: true, opacity: 0.18,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  grp.add(glow);
  grp.position.y = 0.02; // just above the floor
  return grp;
}

/** Legacy alias — older entity code called `createRobot`. */
export function createRobot(colorHex: number): CharacterInstance {
  return createCharacter(DEFAULT_CHARACTER_ID, colorHex);
}

export interface RobotInstance extends CharacterInstance {} // legacy alias
