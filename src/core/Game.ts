import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { Arena } from '../arena/Arena';
import { CashRaidArena } from '../arena/CashRaidArena';
import { MAPS, getMap } from '../arena/MapRegistry';
import { Input } from './Input';
import { Audio } from '../audio/Audio';
import { Effects } from '../effects/Effects';
import { WeaponSystem, raySphere } from '../weapons/WeaponSystem';
import { Actor, ACTOR_FEET_OFFSET } from '../entities/Actor';
import { Player } from '../entities/Player';
import { Bot } from '../entities/Bot';
import { RemotePlayer } from '../entities/RemotePlayer';
import { Projectile, type ProjectileOpts } from '../entities/Projectile';
import { Pickup } from '../entities/Pickup';
import { Match } from '../game/Match';
import { CashRaidRules } from '../game/CashRaidRules';
import type { MatchRules } from '../game/MatchRules';
import { TEAM_COLORS, sameTeam, teamName, enemyOf } from '../game/teams';
import { SHOP_ITEMS, type ShopItem } from '../game/shop';
import { VaultZone } from '../entities/VaultZone';
import { BuyStation } from '../entities/BuyStation';
import { CashDrop } from '../entities/CashDrop';
import { WeaponDrop } from '../entities/WeaponDrop';
import { HUD } from '../ui/HUD';
import { Menu, type GameSettings } from '../ui/Menu';
import { BuyMenu } from '../ui/BuyMenu';
import { NetClient } from '../net/NetClient';
import type { ServerMsg, NetPlayer, LobbyConfig } from '../net/protocol';
import { WEAPONS, WEAPON_ORDER } from '../weapons/Weapons';
import { loadModels, loadCharacter, CHARACTERS, DEFAULT_CHARACTER_ID } from './Models';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { DamageInfo, HitscanResult, MatchConfig, GameState, GameMode, Team } from './types';

const WEAPON_LABEL: Record<string, string> = {
  railgun: 'RAILGUN', shard: 'SHARD CANNON', rocket: 'ROCKET',
  pulse: 'PULSE RIFLE', pulse_combo: 'PULSE COMBO', void: 'THE VOID',
};

/** Persist the player's character pick across sessions. */
const CHARACTER_LS_KEY = 'fp.character';
function loadStoredCharacter(): string {
  try {
    const v = localStorage.getItem(CHARACTER_LS_KEY);
    if (v && CHARACTERS.some((c) => c.id === v)) return v;
  } catch { /* localStorage may be unavailable */ }
  return DEFAULT_CHARACTER_ID;
}
function saveStoredCharacter(id: string) {
  try { localStorage.setItem(CHARACTER_LS_KEY, id); } catch { /* ignore */ }
}

/** Persist the player's quality preference. Default is `fast` so the game
 *  is smooth out-of-the-box; players opt-in to bloom + bigger shadows. */
const QUALITY_LS_KEY = 'fp.quality';
function loadStoredQuality(): GameSettings['quality'] {
  try {
    const v = localStorage.getItem(QUALITY_LS_KEY);
    if (v === 'high' || v === 'fast') return v;
  } catch { /* ignore */ }
  return 'fast';
}
function saveStoredQuality(q: GameSettings['quality']) {
  try { localStorage.setItem(QUALITY_LS_KEY, q); } catch { /* ignore */ }
}

/** Deterministic per-bot character pick (skipping the default robot) seeded
 *  by the bot's index, so the same lineup looks the same each round. */
function botCharacter(seed: number): string {
  const pool = CHARACTERS.filter((c) => c.id !== DEFAULT_CHARACTER_ID);
  if (pool.length === 0) return DEFAULT_CHARACTER_ID;
  return pool[seed % pool.length].id;
}

const BOT_NAMES = ['VEX', 'RAZE', 'NOVA', 'KILO', 'ZERO', 'ORYX', 'BANE'];
const BOT_COLORS = [0xff7a18, 0xff3b3b, 0xb98bff, 0x6dff8a, 0xffd23f, 0xff5ec4, 0x5ec8ff];

const RESPAWN_DELAY = 2.5;
/** Seconds an actor must channel inside a vault to deposit or steal. */
const DEPOSIT_TIME = 2;
/** Fraction of carried money that survives as a ground drop on death. */
const DEATH_DROP_FRACTION = 0.70;

/**
 * Central orchestrator: owns the renderer/scene/camera, all subsystems and
 * the game state machine (menu → playing → paused → matchover). Entities call
 * back into the public combat/spawn methods declared here.
 */
export class Game {
  renderer!: THREE.WebGLRenderer;
  /** Post-FX pipeline (bloom + output). Undefined on the `fast` quality
   *  tier, in which case the loop renders straight through. */
  composer?: EffectComposer;
  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;

  physics!: Physics;
  arena!: Arena;
  input!: Input;
  audio!: Audio;
  effects!: Effects;
  weapons!: WeaponSystem;
  hud!: HUD;
  menu!: Menu;

  actors: Actor[] = [];
  bots: Bot[] = [];
  player: Player | null = null;
  projectiles: Projectile[] = [];
  pickups: Pickup[] = [];
  match!: MatchRules;

  // Cash Raid state (null / empty in deathmatch)
  cashRules: CashRaidRules | null = null;
  vaults: VaultZone[] = [];
  buyStations: BuyStation[] = [];
  cashDrops: CashDrop[] = [];
  weaponDrops: WeaponDrop[] = [];
  buyMenu!: BuyMenu;

  // online play
  mode: 'offline' | 'online' = 'offline';
  net: NetClient | null = null;
  localId = 0;
  remotes = new Map<number, RemotePlayer>();

  state: GameState = 'menu';
  /** Active rule set for the current match. */
  gameMode: GameMode = 'deathmatch';
  time = 0;
  settings: GameSettings = {
    sensitivity: 1.0, volume: 0.7, fov: 95,
    quality: loadStoredQuality(),
  };
  /** The character the local player picked on the character-select screen. */
  characterId: string = loadStoredCharacter();

  /** Camera-shake "trauma" (0..1); decays each frame, read by `Player`. */
  shakeTrauma = 0;

  private lastFrame = 0;
  private menuTime = 0;
  private lastConfig: MatchConfig | null = null;
  private firstBloodDone = false;
  private parent!: HTMLElement;
  private inputAccum = 0;
  private onlineUrl = '';
  private onlineName = 'PLAYER';
  private roomCode = '';

  static async create(parent: HTMLElement): Promise<Game> {
    const g = new Game();
    g.parent = parent;

    const fast = g.settings.quality === 'fast';
    g.renderer = new THREE.WebGLRenderer({
      antialias: !fast, powerPreference: 'high-performance',
    });
    g.renderer.setPixelRatio(Math.min(window.devicePixelRatio, fast ? 1.25 : 2));
    g.renderer.setSize(window.innerWidth, window.innerHeight);
    g.renderer.shadowMap.enabled = true;
    g.renderer.shadowMap.type = fast ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;
    g.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    g.renderer.toneMappingExposure = 1.0;
    parent.appendChild(g.renderer.domElement);

    g.scene = new THREE.Scene();
    g.scene.background = new THREE.Color(0x0a0e16);
    g.scene.fog = new THREE.Fog(0x0a0e16, 45, 150);

    g.camera = new THREE.PerspectiveCamera(g.settings.fov, window.innerWidth / window.innerHeight, 0.05, 400);
    g.scene.add(g.camera);
    g.setupLights();
    g.setupEnvironment();
    g.setupComposer();

    g.physics = await Physics.create();
    g.arena = new Arena(g.scene, g.physics);
    g.arena.build();
    await loadModels(import.meta.env.BASE_URL);

    g.effects = new Effects(g.scene);
    g.audio = new Audio();
    g.input = new Input(g.renderer.domElement);
    g.weapons = new WeaponSystem(g);
    g.hud = new HUD(parent);
    g.hud.setVisible(false);
    g.buyMenu = new BuyMenu(parent);
    g.menu = new Menu(parent, {
      settings: g.settings,
      onStart: (cfg) => g.startMatch(cfg),
      onResume: () => g.resume(),
      onRestart: () => g.restart(),
      onMainMenu: () => g.toMainMenu(),
      onCreateRoom: (url, name, config) => g.createRoom(url, name, config),
      onJoinRoom: (url, name, code) => g.joinRoom(url, name, code),
      onLeaveRoom: () => g.leaveOnline(),
      onLobbyReady: (r) => g.lobbySetReady(r),
      onLobbySelectTeam: (t) => g.lobbySelectTeam(t),
      onLobbyConfig: (c) => g.lobbyConfig(c),
      onLobbyKick: (id) => g.lobbyKick(id),
      onLobbyStart: () => g.lobbyStart(),
      onCharacter: (id) => g.setCharacter(id),
      getCharacter: () => g.characterId,
      onQuality: (q) => { g.settings.quality = q; saveStoredQuality(q); },
    });

    g.input.onPointerUnlock = () => { if (g.state === 'playing') g.pause(); };
    g.renderer.domElement.addEventListener('click', () => {
      if (g.state === 'playing' && !g.input.locked) g.input.requestLock();
    });
    window.addEventListener('resize', () => g.onResize());

    // expose for debugging / automated smoke tests
    (window as unknown as { __game: Game }).__game = g;

    g.lastFrame = performance.now();
    requestAnimationFrame(g.loop);
    return g;
  }

  private setupLights() {
    this.scene.add(new THREE.HemisphereLight(0x8aa0ff, 0x1a1d26, 0.9));
    this.scene.add(new THREE.AmbientLight(0x44506a, 0.65));

    // dim cool fill from the opposite side so shadowed faces still read
    const fill = new THREE.DirectionalLight(0x6f86c8, 0.55);
    fill.position.set(-28, 30, -24);
    this.scene.add(fill);

    const fast = this.settings.quality === 'fast';
    const dir = new THREE.DirectionalLight(0xfff2e0, 1.85);
    dir.position.set(34, 54, 22);
    dir.castShadow = true;
    // Smaller shadow map + tighter frustum on fast — the shadow framebuffer
    // is the single biggest per-frame cost on mid-range GPUs.
    const shadowSize = fast ? 1024 : 2048;
    dir.shadow.mapSize.set(shadowSize, shadowSize);
    const c = dir.shadow.camera;
    const shadowExtent = fast ? 55 : 90;
    c.left = -shadowExtent; c.right = shadowExtent;
    c.top  = shadowExtent;  c.bottom = -shadowExtent;
    c.near = 1; c.far = fast ? 160 : 220;
    dir.shadow.bias = -0.0009;
    this.scene.add(dir);
    this.scene.add(dir.target);

    // Skip the centre glow point light on fast — it adds a draw cost without
    // changing the silhouette read of the level.
    if (!fast) {
      const glow = new THREE.PointLight(0x36e0ff, 16, 70);
      glow.position.set(0, 15, 0);
      this.scene.add(glow);
    }
  }

  /** A gradient sky dome behind the arena. */
  private setupEnvironment() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(280, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color(0x070d18) },
          bottom: { value: new THREE.Color(0x030406) },
          horizon: { value: new THREE.Color(0x101c30) },
        },
        vertexShader: `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
          varying vec3 vPos;
          void main() {
            float h = normalize(vPos).y;
            vec3 col = h > 0.0
              ? mix(horizon, top, pow(h, 0.5))
              : mix(horizon, bottom, pow(-h, 0.5));
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    );
    this.scene.add(sky);
  }

  /** Bloom post-processing pipeline (makes emissive trims / FX glow).
   *  Skipped entirely on 'fast' quality — see `render()` below. */
  private setupComposer() {
    if (this.settings.quality === 'fast') return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.5, 0.45, 0.85,
    ));
    this.composer.addPass(new OutputPass());
  }

  // ===================================================================
  //  main loop
  // ===================================================================

  private loop = (now: number) => {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.state === 'playing') {
      if (this.mode === 'online') this.updateOnline(dt);
      else this.updatePlaying(dt);
    } else if (this.state === 'paused') {
      if (this.input.keyPressed('Escape')) this.resume();
    } else if (this.state === 'menu') {
      this.updateMenuBackdrop(dt);
    }

    this.audio.setMasterVolume(this.settings.volume);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
    requestAnimationFrame(this.loop);
  };

  private updateMenuBackdrop(dt: number) {
    this.menuTime += dt;
    const a = this.menuTime * 0.13;
    this.camera.position.set(Math.cos(a) * 40, 13 + Math.sin(a * 0.6) * 4, Math.sin(a) * 40);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 4, 0);
  }

  private updatePlaying(dt: number) {
    this.time += dt;
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.8);

    if (this.input.keyPressed('Escape')) {
      if (this.buyMenu.isOpen) this.buyMenu.close();
      else { this.pause(); return; }
    }

    const player = this.player!;
    player.update(dt);
    for (const bot of this.bots) bot.update(dt);

    this.physics.step();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.projectiles[i].update(dt);
      if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
    }
    for (const p of this.pickups) p.update(dt);
    for (let i = this.weaponDrops.length - 1; i >= 0; i--) {
      this.weaponDrops[i].update(dt);
      if (this.weaponDrops[i].dead) this.weaponDrops.splice(i, 1);
    }
    this.effects.update(dt);
    this.updateRespawns();
    if (this.gameMode === 'cashraid') this.updateCashRaid(dt);

    if (this.match.update(dt, this.actors)) { this.endMatch(); return; }

    // audio listener follows the camera
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    this.audio.updateListener(this.camera.position, fwd);

    for (const bot of this.bots) bot.syncMesh(dt);

    const showScores = this.input.key('Tab');
    this.hud.toggleScoreboard(showScores, this.match, this.actors, player, this.cashRules);
    this.hud.update(player, this.match, this.actors, this.time, this.cashRules);
  }

  private updateRespawns() {
    for (const a of this.actors) {
      if (a.alive) continue;
      const dead = this.time - a.deathTime;
      if (a === this.player) {
        const early = dead > 1.2 && this.input.mousePressed(0);
        if (dead >= RESPAWN_DELAY || early) {
          this.respawnActor(a);
          this.hud.hideRespawn();
        } else {
          this.hud.showRespawn(dead < 1.2 ? 'FRAGGED' : 'CLICK OR WAIT TO RESPAWN');
        }
      } else if (dead >= RESPAWN_DELAY) {
        this.respawnActor(a);
      }
    }
  }

  // ===================================================================
  //  match lifecycle
  // ===================================================================

  private async startMatch(config: MatchConfig) {
    this.clearMatch();
    this.lastConfig = config;
    this.gameMode = config.mode;
    this.ensureArena(config.mode, config.mapId);
    this.firstBloodDone = false;
    this.time = 0;

    const cashRaid = config.mode === 'cashraid';
    this.cashRules = cashRaid ? new CashRaidRules(config) : null;
    this.match = this.cashRules ?? new Match(config);

    const spawns = this.arena.spawnPoints;
    // In Cash Raid the local player + bots are split into two balanced teams;
    // team 1 takes the extra slot when the headcount is odd.
    const team1Count = Math.ceil((1 + config.botCount) / 2);

    // Pre-load any character meshes this match will need so spawning is
    // synchronous and there's no first-paint pop-in.
    const needed = new Set<string>([this.characterId]);
    for (let i = 0; i < config.botCount; i++) needed.add(botCharacter(i));
    await Promise.all([...needed].map((id) => loadCharacter(id)));

    this.player = new Player(this, 'YOU', spawns[0], this.camera);
    this.player.characterId = this.characterId;
    this.player.team = cashRaid ? 1 : 0;
    this.actors.push(this.player);

    for (let i = 0; i < config.botCount; i++) {
      // bots 0..(team1Count-2) join team 1 (the player already filled one slot)
      const team: Team = cashRaid ? (i < team1Count - 1 ? 1 : 2) : 0;
      const color = cashRaid ? TEAM_COLORS[team] : BOT_COLORS[i % BOT_COLORS.length];
      const bot = new Bot(
        this,
        BOT_NAMES[i % BOT_NAMES.length],
        color,
        spawns[(i + 1) % spawns.length],
        config.difficulty,
        botCharacter(i),
      );
      bot.team = team;
      this.actors.push(bot);
      this.bots.push(bot);
      this.scene.add(bot.mesh);
    }

    for (const ps of this.arena.pickupSpawns) {
      this.pickups.push(new Pickup(this, ps.type, ps.pos));
    }

    // Cash Raid: basic-weapon-only loadout (purchases extend it) + vaults/kiosks
    for (const a of this.actors) {
      a.loadout = cashRaid ? new Set(['pulse']) : new Set(WEAPON_ORDER);
    }
    if (cashRaid) this.buildCashZones();

    for (const a of this.actors) this.respawnActor(a);

    // step once so the query pipeline / broad-phase includes the new actor
    // colliders before the first gameplay frame resolves movement
    this.physics.step();

    this.state = 'playing';
    this.menu.hideAll();
    this.hud.setVisible(true);
    this.audio.resume();
    this.audio.setMuffled(false);
    this.input.requestLock();
    this.lastFrame = performance.now();
  }

  private clearMatch(keepNet = false) {
    if (!keepNet) {
      this.net?.close();
      this.net = null;
      this.mode = 'offline';
    }
    this.localId = 0;
    this.remotes.clear();
    this.player?.dispose();
    for (const a of this.actors) {
      this.scene.remove(a.mesh);
      this.physics.removeActor(a.body, a.collider);
    }
    for (const p of this.projectiles) p.dispose();
    for (const p of this.pickups) p.dispose();
    for (const v of this.vaults) v.dispose();
    for (const b of this.buyStations) b.dispose();
    for (const d of this.cashDrops) d.dispose();
    for (const d of this.weaponDrops) d.dispose();
    this.actors = [];
    this.bots = [];
    this.projectiles = [];
    this.pickups = [];
    this.vaults = [];
    this.buyStations = [];
    this.cashDrops = [];
    this.weaponDrops = [];
    this.cashRules = null;
    this.buyMenu.close();
    this.player = null;
  }

  /** The current arena as a CashRaidArena, or null in deathmatch. */
  get cashArena(): CashRaidArena | null {
    return this.arena instanceof CashRaidArena ? this.arena : null;
  }

  /** Id of the currently-built map, used to detect when a swap is needed. */
  private currentMapId: string | null = null;

  /** Swap the live arena to the requested map (lookup via the registry). */
  private ensureArena(mode: GameMode, mapId?: string) {
    const def = getMap(mapId, mode);
    if (this.currentMapId === def.id) return;
    if (this.arena) this.arena.dispose();
    this.arena = def.factory(this.scene, this.physics);
    this.arena.build();
    this.currentMapId = def.id;
  }

  private restart() {
    // online matches reset on the server; "play again" returns to the hub
    if (this.mode === 'online') { this.leaveOnline(); return; }
    if (this.lastConfig) this.startMatch(this.lastConfig);
  }

  private endMatch() {
    this.state = 'matchover';
    this.input.exitLock();
    this.audio.setMuffled(true);
    this.hud.setVisible(false);
    this.buyMenu.close();
    if (this.gameMode === 'cashraid' && this.cashRules) {
      const r = this.cashRules;
      const won = !!this.player && r.winner === this.player.team;
      this.audio.announce(won ? 'You win' : r.winner === 0 ? 'Draw' : 'Match over');
      this.menu.showCashRaidEnd(r, this.actors, this.player!);
    } else {
      const m = this.match as Match;
      const ranking = m.ranking(this.actors);
      this.audio.announce(m.winner === this.player ? 'You win' : 'Match over');
      this.menu.showEnd(ranking, m.winner, this.player!);
    }
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.audio.setMuffled(true);
    this.buyMenu.close();
    this.menu.showPause();
  }

  private resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menu.hideAll();
    this.audio.setMuffled(false);
    this.audio.resume();
    this.input.requestLock();
    this.lastFrame = performance.now();
  }

  private toMainMenu() {
    this.clearMatch();
    this.state = 'menu';
    this.hud.setVisible(false);
    this.hud.hideRespawn();
    this.audio.setMuffled(false);
    this.menu.showMain();
  }

  private respawnActor(a: Actor) {
    a.respawn(this.chooseSpawn(a));
    if (this.gameMode === 'cashraid' && a.isBot) this.botAutoBuy(a);
    this.effects.flash(a.position.clone(), a.colorHex, 2.2, 0.3);
    this.audio.play('spawn', a === this.player ? undefined : a.position);
  }

  /** Spawn points an actor may use — its team's subset in Cash Raid. */
  private spawnCandidates(actor?: Actor): THREE.Vector3[] {
    const all = this.arena.spawnPoints;
    if (this.gameMode !== 'cashraid' || !actor || actor.team === 0) return all;
    const half = Math.ceil(all.length / 2);
    return actor.team === 1 ? all.slice(0, half) : all.slice(half);
  }

  /** Pick the spawn point furthest from currently-alive actors. */
  private chooseSpawn(actor?: Actor): THREE.Vector3 {
    const candidates = this.spawnCandidates(actor);
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const sp of candidates) {
      let minD = Infinity;
      for (const a of this.actors) {
        if (a.alive) minD = Math.min(minD, a.position.distanceTo(sp));
      }
      const score = (minD === Infinity ? 100 : minD) + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    return best;
  }

  // ===================================================================
  //  combat API used by weapons / projectiles / entities
  // ===================================================================

  /** Cast a ray against world geometry and actor bodies. */
  hitscan(origin: THREE.Vector3, dir: THREE.Vector3, range: number, shooter: Actor): HitscanResult {
    const worldHit = this.physics.raycastWorld(origin, dir, range);
    let dist = worldHit ? worldHit.toi : range;
    const normal = worldHit ? worldHit.normal : dir.clone().negate();
    let actor: Actor | null = null;
    let headshot = false;

    for (const a of this.actors) {
      if (a === shooter || !a.alive) continue;
      for (const s of a.hitSpheres()) {
        const t = raySphere(origin, dir, s.center, s.radius);
        if (t !== null && t < dist) { dist = t; actor = a; headshot = s.head; }
      }
    }
    return {
      point: origin.clone().addScaledVector(dir, dist),
      normal,
      actor,
      headshot,
      distance: dist,
    };
  }

  /**
   * True when at least one of the actor's hit spheres has a clear line from
   * an explosion centre. Walls block splash; peeking around a corner (head
   * exposed but torso not) still takes damage. A small margin lets blasts
   * that detonate right against a wall still tag someone braced on the
   * other side of a thin pillar.
   */
  private splashHasLineOfSight(center: THREE.Vector3, target: Actor): boolean {
    for (const s of target.hitSpheres()) {
      const to = s.center.clone().sub(center);
      const dist = to.length();
      if (dist < 1e-3) return true;
      to.multiplyScalar(1 / dist);
      const margin = Math.min(s.radius * 0.6, 0.3);
      const hit = this.physics.raycastWorld(center, to, Math.max(0, dist - margin));
      if (!hit) return true;
    }
    return false;
  }

  spawnProjectile(opts: ProjectileOpts) {
    this.projectiles.push(new Projectile(this, opts));
  }

  /** Add camera-shake trauma (clamped). Weapons, hits and blasts call this. */
  shake(amount: number) {
    this.shakeTrauma = Math.min(1, this.shakeTrauma + amount);
  }

  applyDamage(target: Actor, info: DamageInfo) {
    if (this.mode === 'online') { this.applyDamageOnline(target, info); return; }
    // Cash Raid: no friendly fire (self-damage — rocket jumps — still lands).
    if (
      this.gameMode === 'cashraid' && info.attacker &&
      info.attacker !== target && sameTeam(info.attacker, target)
    ) return;
    const res = target.takeDamage(info);
    if (res.dealt > 0) {
      this.effects.impact(info.point, new THREE.Vector3(0, 1, 0), 0xff5a5a);
      this.audio.play('hit', target.position);
      if (info.attacker === this.player && target !== this.player) {
        this.hud.showHitmarker(res.died);
        if (!res.died) this.audio.play('hitmarker');
      }
      if (target === this.player) {
        this.hud.showDamageFlash();
        this.shake(0.18 + Math.min(0.4, res.dealt / 240));
      }
    }
    if (res.died) this.onActorDied(target, info.attacker, info.weaponId, info.headshot);
  }

  /** Apply distance-falloff splash damage + knockback within `radius`. */
  radialDamage(
    center: THREE.Vector3, radius: number, maxDamage: number,
    source: Actor | null, weaponId: string, knockback: number,
    exclude: Actor | null,
  ) {
    if (this.mode === 'online') {
      this.radialDamageOnline(center, radius, maxDamage, weaponId, knockback);
      return;
    }
    for (const a of this.actors) {
      if (!a.alive || a === exclude) continue;
      // Cash Raid: splash spares teammates (the source still hurts itself).
      if (this.gameMode === 'cashraid' && source && a !== source && sameTeam(source, a)) continue;
      const d = a.position.distanceTo(center);
      if (d > radius) continue;
      // Solid geometry blocks splash: a rocket on the far side of a wall
      // should not damage someone behind it. Self-damage (rocket jumps) is
      // exempt because the blast originates at the shooter's feet.
      if (a !== source && !this.splashHasLineOfSight(center, a)) continue;
      // Eased falloff: full damage at the centre, ~75% at half-radius,
      // tapering to 0 at the edge. Feels punchier than a pure linear curve
      // for close-but-not-direct blasts (rocket cooked off near a target).
      const falloff = Math.pow(1 - d / radius, 0.6);
      const kb = a.position.clone().sub(center);
      kb.y += radius * 0.35;
      if (kb.lengthSq() < 1e-4) kb.set(0, 1, 0);
      kb.normalize().multiplyScalar(knockback * (0.45 + falloff));
      this.applyDamage(a, {
        amount: maxDamage * falloff,
        attacker: source,
        weaponId,
        headshot: false,
        point: a.position.clone(),
        knockback: kb,
        splash: true,
      });
    }
  }

  /** Resolve scoring, kill feed and announcer after an actor dies. */
  onActorDied(victim: Actor, killer: Actor | null, weaponId: string, headshot: boolean) {
    this.effects.explosion(victim.position.clone(), 2.4, victim.colorHex);
    this.audio.play('die', victim.position);

    // Drop the victim's carried weapon for others to grab. Skip the basic
    // pulse rifle (everyone has one) and only in offline matches — online
    // play would need server-authoritative drop tracking.
    if (this.mode === 'offline' && victim.currentWeapon && victim.currentWeapon !== 'pulse') {
      const at = victim.position.clone();
      at.y -= ACTOR_FEET_OFFSET - 0.2;
      this.weaponDrops.push(new WeaponDrop(this, victim.currentWeapon, at));
    }

    // Cash Raid: a dead carrier drops most of their money on the ground.
    if (this.gameMode === 'cashraid' && victim.carried > 0) {
      const dropped = Math.floor(victim.carried * DEATH_DROP_FRACTION);
      victim.carried = 0;
      if (dropped > 0) {
        this.spawnCashDrop(victim.position, dropped);
        this.hud.addCashEvent(`${victim.name} dropped  $${dropped.toLocaleString()}`);
      }
    }

    const suicide = !killer || killer === victim;
    if (suicide) victim.frags = Math.max(0, victim.frags - 1);
    else killer!.frags++;

    victim.spree = 0;
    victim.multiKill = 0;

    const label = WEAPON_LABEL[weaponId] ?? weaponId.toUpperCase();
    this.hud.addKill(
      suicide ? '☠' : killer!.name,
      victim.name,
      label,
      !suicide && killer === this.player,
      victim === this.player,
      suicide ? 0 : killer!.team,
      victim.team,
    );

    if (suicide) return;
    const k = killer!;
    k.multiKill = this.time - k.lastKillTime < 4 ? k.multiKill + 1 : 1;
    k.lastKillTime = this.time;
    k.spree++;

    const big = this.streakBig(k, headshot);
    if (big && (k === this.player || big === 'FIRST BLOOD')) {
      this.hud.announce(big);
      this.audio.announce(big);
    }
  }

  /** Pick the announcer line for a kill (multi-kill / spree / headshot). */
  private streakBig(k: Actor, headshot: boolean): string {
    if (!this.firstBloodDone) { this.firstBloodDone = true; return 'FIRST BLOOD'; }
    if (k.multiKill >= 6) return 'GODLIKE';
    if (k.multiKill === 5) return 'MONSTER KILL';
    if (k.multiKill === 4) return 'MEGA KILL';
    if (k.multiKill === 3) return 'MULTI KILL';
    if (k.multiKill === 2) return 'DOUBLE KILL';
    if (headshot) return 'HEADSHOT';
    if (k.spree === 5) return 'KILLING SPREE';
    if (k.spree === 10) return 'RAMPAGE';
    if (k.spree === 15) return 'DOMINATING';
    if (k.spree >= 20 && k.spree % 5 === 0) return 'UNSTOPPABLE';
    return '';
  }

  // ===================================================================
  //  Cash Raid
  // ===================================================================

  /** Build the vault zones + buy-station kiosks for the active map. */
  private buildCashZones() {
    const arena = this.cashArena;
    if (!arena) return;
    for (const def of arena.vaultDefs) {
      this.vaults.push(new VaultZone(this.scene, def, TEAM_COLORS[def.team]));
    }
    for (const def of arena.buyDefs) {
      this.buyStations.push(new BuyStation(this.scene, def, TEAM_COLORS[def.team]));
    }
  }

  /** Per-frame Cash Raid update: zones, cash drops, the local player's E/B. */
  private updateCashRaid(dt: number) {
    for (const v of this.vaults) v.update(dt);
    for (const b of this.buyStations) b.update(dt);
    for (let i = this.cashDrops.length - 1; i >= 0; i--) {
      const d = this.cashDrops[i];
      d.update(dt);
      if (!d.dead) continue;
      if (d.collectedBy) {
        this.effects.flash(d.pos.clone().setY(d.pos.y + 0.6), 0xffd23f, 2, 0.3);
        this.audio.play('pickup', d.pos);
        if (d.collectedBy === this.player) {
          this.hud.addCashEvent(`recovered  $${d.amount.toLocaleString()}`);
        }
      }
      d.dispose();
      this.cashDrops.splice(i, 1);
    }
    for (const bot of this.bots) this.runBotVaultChannel(bot);
    this.updatePlayerInteract();
  }

  /** Drive the local player's vault channel + buy station from E / B keys. */
  private updatePlayerInteract() {
    const p = this.player;
    if (!p || !this.cashRules) return;
    if (!p.alive) {
      p.depositChannelStart = 0;
      if (this.buyMenu.isOpen) this.buyMenu.close();
      this.hud.setPrompt('');
      return;
    }

    // --- buy station ---
    const atBuy = this.buyStations.some((b) => b.team === p.team && b.containsActor(p));
    if (this.buyMenu.isOpen) {
      if (this.input.keyPressed('KeyB') || !atBuy) {
        this.buyMenu.close();
      } else {
        for (let i = 0; i < SHOP_ITEMS.length; i++) {
          if (this.input.keyPressed('Digit' + (i + 1))) this.tryBuy(SHOP_ITEMS[i]);
        }
      }
    } else if (atBuy && this.input.keyPressed('KeyB')) {
      this.openBuyMenu();
    }

    // --- vault deposit / steal channel ---
    const ownVault = this.vaults.find((v) => v.team === p.team && v.containsActor(p));
    const enemyVault = this.vaults.find((v) => v.team !== p.team && v.containsActor(p));
    const canDeposit = !!ownVault && p.carried > 0;
    const canSteal = !!enemyVault;

    if ((canDeposit || canSteal) && this.input.key('KeyE')) {
      if (p.depositChannelStart === 0) p.depositChannelStart = this.time;
      const prog = (this.time - p.depositChannelStart) / DEPOSIT_TIME;
      if (prog >= 1) {
        p.depositChannelStart = 0;
        if (ownVault) this.doDeposit(p); else this.doSteal(p);
      } else {
        const pct = Math.floor(prog * 100);
        this.hud.setPrompt(ownVault ? `DEPOSITING…  ${pct}%` : `RAIDING VAULT…  ${pct}%`);
      }
    } else {
      p.depositChannelStart = 0;
      if (this.buyMenu.isOpen) this.hud.setPrompt('');
      else if (canDeposit) this.hud.setPrompt(`HOLD  E  TO DEPOSIT  $${Math.floor(p.carried).toLocaleString()}`);
      else if (enemyVault) this.hud.setPrompt('HOLD  E  TO RAID THE ENEMY VAULT');
      else if (atBuy) this.hud.setPrompt('PRESS  B  TO BUY');
      else this.hud.setPrompt('');
    }
  }

  private doDeposit(a: Actor) {
    const amt = this.cashRules!.deposit(a);
    if (amt <= 0) return;
    this.audio.play('pickupbig', a.position);
    this.effects.flash(a.position.clone(), TEAM_COLORS[a.team], 2.6, 0.35);
    this.hud.addCashEvent(`${a.name} banked  $${amt.toLocaleString()}`);
  }

  private doSteal(a: Actor) {
    const amt = this.cashRules!.steal(a);
    if (amt <= 0) return;
    this.audio.play('pickupbig', a.position);
    this.effects.flash(a.position.clone(), 0xffd23f, 2.6, 0.35);
    this.hud.addCashEvent(`${a.name} raided  $${amt.toLocaleString()}  from ${teamName(enemyOf(a.team))}`);
  }

  /** Run a bot's vault deposit/steal channel when its brain wants to. */
  private runBotVaultChannel(bot: Bot) {
    if (!bot.alive || !this.cashRules) { bot.depositChannelStart = 0; return; }
    const ownVault = this.vaults.find((v) => v.team === bot.team && v.containsActor(bot));
    const enemyVault = this.vaults.find((v) => v.team !== bot.team && v.containsActor(bot));
    const canDeposit = !!ownVault && bot.carried > 0;
    const canSteal = !!enemyVault;
    if (bot.wantVaultInteract && (canDeposit || canSteal)) {
      if (bot.depositChannelStart === 0) bot.depositChannelStart = this.time;
      if (this.time - bot.depositChannelStart >= DEPOSIT_TIME) {
        bot.depositChannelStart = 0;
        if (ownVault) this.doDeposit(bot); else this.doSteal(bot);
      }
    } else {
      bot.depositChannelStart = 0;
    }
  }

  /** A bot equips one weapon from the team bank shortly after spawning. */
  private botAutoBuy(bot: Actor) {
    if (!this.cashRules || bot.loadout.size > 1) return;
    const bank = this.cashRules.bank;
    for (const id of ['shard', 'railgun', 'rocket']) {
      const item = SHOP_ITEMS.find((s) => s.weaponId === id);
      if (!item) continue;
      if (bank[bot.team] >= item.cost + 4000) { // leave a reserve for the team
        bank[bot.team] -= item.cost;
        bot.loadout.add(id);
        bot.inventory.add(id);
        bot.ammo[id] = WEAPONS[id].startAmmo;
        return;
      }
    }
  }

  private openBuyMenu() {
    const p = this.player!;
    this.buyMenu.show({ bank: this.cashRules!.bank[p.team] ?? 0, owned: p.loadout });
  }

  private tryBuy(item: ShopItem) {
    const p = this.player;
    if (!p || p.team === 0) return;
    if (item.kind === 'weapon' && item.weaponId && p.loadout.has(item.weaponId)) return;
    // online: the server is authoritative — just request the purchase
    if (this.mode === 'online') {
      this.net?.send({ t: 'buy', itemId: item.id });
      return;
    }
    if (!this.cashRules) return;
    const bank = this.cashRules.bank;
    if ((bank[p.team] ?? 0) < item.cost) {
      this.audio.play('hitmarker');
      return;
    }
    bank[p.team] -= item.cost;
    this.grantPurchase(p, item);
    this.audio.play('pickup');
    this.hud.addCashEvent(`${p.name} bought ${item.label}  −$${item.cost.toLocaleString()}`);
    this.openBuyMenu(); // re-render with the new balance / ownership
  }

  private grantPurchase(p: Player, item: ShopItem) {
    if (item.kind === 'weapon' && item.weaponId) {
      p.loadout.add(item.weaponId);
      p.inventory.add(item.weaponId);
      p.ammo[item.weaponId] = WEAPONS[item.weaponId].startAmmo;
    } else if (item.kind === 'armor') {
      p.armor = Math.min(p.maxArmor, p.armor + (item.amount ?? 75));
    } else if (item.kind === 'ammo') {
      p.giveAmmoAll();
    }
  }

  /** Drop a briefcase of money at an actor's position (death drop). */
  spawnCashDrop(center: THREE.Vector3, amount: number) {
    const feet = center.clone();
    feet.y -= ACTOR_FEET_OFFSET;
    this.cashDrops.push(new CashDrop(this, amount, feet));
  }

  // ===================================================================
  //  online play — rooms, lobby and matches
  // ===================================================================

  /** Connect, then create a room with the given lobby config. */
  async createRoom(url: string, name: string, config: LobbyConfig) {
    const net = await this.connectServer(url, name);
    net?.send({ t: 'createRoom', name: this.onlineName, config, character: this.characterId });
  }

  /** Connect, then join an existing room by invite code. */
  async joinRoom(url: string, name: string, code: string) {
    const net = await this.connectServer(url, name);
    net?.send({
      t: 'joinRoom',
      code: code.toUpperCase().trim(),
      name: this.onlineName,
      character: this.characterId,
    });
  }

  /** Persist the player's character pick + notify the server when online. */
  setCharacter(id: string) {
    if (!CHARACTERS.some((c) => c.id === id)) return;
    this.characterId = id;
    saveStoredCharacter(id);
    if (this.net && this.net.connected) {
      this.net.send({ t: 'lobbySetCharacter', character: id });
    }
  }

  private async connectServer(url: string, name: string): Promise<NetClient | null> {
    this.clearMatch();
    this.onlineUrl = url;
    this.onlineName = (name || 'PLAYER').toUpperCase().slice(0, 14);
    this.menu.showConnecting();
    const net = new NetClient();
    net.onMessage = (m) => this.handleNet(m);
    net.onClose = () => this.onNetClose();
    try {
      await net.connect(url);
    } catch (e) {
      this.menu.showOnlineHub(e instanceof Error ? e.message : 'connection failed');
      return null;
    }
    this.net = net;
    this.mode = 'online';
    return net;
  }

  // ---- lobby messaging (wired to the Menu's lobby screen) ----
  lobbySetReady(ready: boolean) { this.net?.send({ t: 'lobbySetReady', ready }); }
  lobbySelectTeam(team: 1 | 2) { this.net?.send({ t: 'lobbySelectTeam', team }); }
  lobbyConfig(config: LobbyConfig) { this.net?.send({ t: 'lobbyConfig', config }); }
  lobbyKick(id: number) { this.net?.send({ t: 'lobbyKick', id }); }
  lobbyStart() { this.net?.send({ t: 'lobbyStart' }); }
  leaveOnline() {
    this.net?.send({ t: 'leaveRoom' });
    this.net?.close();
    this.net = null;
    this.clearMatch();
    this.state = 'menu';
    this.hud.setVisible(false);
    this.audio.setMuffled(false);
    this.menu.showOnlineHub();
  }

  private handleNet(msg: ServerMsg) {
    switch (msg.t) {
      case 'roomJoined':    this.onRoomJoined(msg); break;
      case 'lobbyState':    this.onLobbyState(msg); break;
      case 'roomError':     this.menu.showOnlineHub(msg.message); break;
      case 'kicked':        this.onKicked(); break;
      case 'matchStart':    this.onMatchStart(msg); break;
      case 'state':         this.onNetState(msg); break;
      case 'playerLeft':    this.removeRemote(msg.id); break;
      case 'fire':          this.onRemoteFire(msg); break;
      case 'kill':          this.onNetKill(msg); break;
      case 'spawn':         this.onNetSpawn(msg); break;
      case 'matchOver':     this.onNetMatchOver(msg); break;
      case 'matchReset':    this.onNetMatchReset(msg); break;
      case 'cashSpawned':   this.onCashSpawned(msg); break;
      case 'cashCollected': this.onCashCollected(msg); break;
      case 'cashExpired':   this.onCashExpired(msg); break;
      case 'bankUpdate':    this.onBankUpdate(msg); break;
      case 'loadoutUpdate': this.onLoadoutUpdate(msg); break;
      case 'cashEvent':     this.hud.addCashEvent(msg.text); break;
    }
  }

  private onRoomJoined(msg: Extract<ServerMsg, { t: 'roomJoined' }>) {
    this.localId = msg.youId;
    this.roomCode = msg.code;
  }

  private onLobbyState(msg: Extract<ServerMsg, { t: 'lobbyState' }>) {
    if (this.state === 'playing') return; // a late lobby frame after match start
    this.menu.showLobby(msg.lobby, this.localId);
  }

  private onKicked() {
    this.net?.close();
    this.net = null;
    this.clearMatch();
    this.state = 'menu';
    this.menu.showOnlineHub('you were removed from the room');
  }

  private async onMatchStart(msg: Extract<ServerMsg, { t: 'matchStart' }>) {
    this.clearMatch(true);
    this.mode = 'online';
    this.gameMode = msg.match.mode;
    this.localId = msg.youId;
    this.time = 0;
    this.firstBloodDone = false;
    this.ensureArena(this.gameMode, msg.match.mapId);

    // Pre-load every character the match needs (local + remotes + bots).
    const needed = new Set<string>([this.characterId]);
    for (const np of msg.players) needed.add(np.character || 'robot');
    await Promise.all([...needed].map((id) => loadCharacter(id)));

    const cfg: MatchConfig = {
      mode: this.gameMode, botCount: 0, fragLimit: msg.match.fragLimit,
      timeLimitSec: msg.match.timeLeft, difficulty: 'skilled',
      startMoney: msg.match.bank1, winTarget: msg.match.winTarget,
    };
    if (this.gameMode === 'cashraid') {
      const rules = new CashRaidRules(cfg);
      rules.bank[1] = msg.match.bank1;
      rules.bank[2] = msg.match.bank2;
      rules.timeLeft = msg.match.timeLeft;
      this.cashRules = rules;
      this.match = rules;
      this.buildCashZones();
    } else {
      this.cashRules = null;
      this.match = new Match(cfg);
      this.match.timeLeft = msg.match.timeLeft;
    }

    const me = msg.players.find((p) => p.id === this.localId);
    const feet = me
      ? new THREE.Vector3(me.x, me.y, me.z)
      : this.arena.spawnPoints[0].clone();
    this.player = new Player(this, me?.name ?? this.onlineName, feet, this.camera);
    this.player.characterId = me?.character || this.characterId;
    this.player.team = me?.team ?? 0;
    this.player.loadout = this.gameMode === 'cashraid'
      ? new Set(['pulse']) : new Set(WEAPON_ORDER);
    this.actors.push(this.player);
    this.player.respawn(feet);

    for (const np of msg.players) if (np.id !== this.localId) this.addRemote(np);
    this.physics.step();

    this.state = 'playing';
    this.menu.hideAll();
    this.hud.setVisible(true);
    this.audio.resume();
    this.audio.setMuffled(false);
    this.input.requestLock();
    this.lastFrame = performance.now();
  }

  private addRemote(np: NetPlayer) {
    if (np.id === this.localId || this.remotes.has(np.id)) return;
    const r = new RemotePlayer(this, np);
    r.team = np.team;
    this.remotes.set(np.id, r);
    this.actors.push(r);
    this.scene.add(r.mesh);
  }

  private removeRemote(id: number) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.scene.remove(r.mesh);
    this.physics.removeActor(r.body, r.collider);
    this.remotes.delete(id);
    this.actors = this.actors.filter((a) => a !== r);
  }

  private onNetState(msg: Extract<ServerMsg, { t: 'state' }>) {
    this.match.timeLeft = msg.match.timeLeft;
    if (this.cashRules) {
      this.cashRules.bank[1] = msg.match.bank1;
      this.cashRules.bank[2] = msg.match.bank2;
    }
    for (const np of msg.players) {
      if (np.id === this.localId) {
        const p = this.player;
        if (!p) continue;
        if (np.health < p.health - 0.5 && p.alive) {
          this.shake(0.18 + Math.min(0.4, (p.health - np.health) / 240));
        }
        p.health = np.health;
        p.armor = np.armor;
        p.frags = np.frags;
        p.deaths = np.deaths;
        p.carried = np.carried;
        if (!np.alive && p.alive) {
          p.alive = false;
          p.deathTime = this.time;
          p.collider.setEnabled(false);
        }
      } else {
        let r = this.remotes.get(np.id);
        if (!r) { this.addRemote(np); r = this.remotes.get(np.id); }
        r?.applySnapshot(np);
      }
    }
  }

  private onNetSpawn(msg: Extract<ServerMsg, { t: 'spawn' }>) {
    const feet = new THREE.Vector3(msg.x, msg.y, msg.z);
    if (msg.id === this.localId && this.player) {
      this.player.respawn(feet);
      this.hud.hideRespawn();
      this.effects.flash(this.player.position.clone(), this.player.colorHex, 2, 0.3);
      this.audio.play('spawn');
    } else {
      const r = this.remotes.get(msg.id);
      if (r) this.effects.flash(new THREE.Vector3(msg.x, msg.y + 1, msg.z), r.colorHex, 2, 0.3);
      this.audio.play('spawn', feet);
    }
  }

  // ---- Cash Raid network events ----

  private onCashSpawned(msg: Extract<ServerMsg, { t: 'cashSpawned' }>) {
    this.cashDrops.push(new CashDrop(
      this, msg.amount, new THREE.Vector3(msg.x, msg.y, msg.z),
      { id: msg.dropId, passive: true },
    ));
  }

  private onCashCollected(msg: Extract<ServerMsg, { t: 'cashCollected' }>) {
    const i = this.cashDrops.findIndex((d) => d.id === msg.dropId);
    if (i < 0) return;
    const d = this.cashDrops[i];
    this.effects.flash(d.pos.clone().setY(d.pos.y + 0.6), 0xffd23f, 2, 0.3);
    this.audio.play('pickup', d.pos);
    if (msg.byId === this.localId) this.hud.addCashEvent(`recovered  $${msg.amount.toLocaleString()}`);
    d.dispose();
    this.cashDrops.splice(i, 1);
  }

  private onCashExpired(msg: Extract<ServerMsg, { t: 'cashExpired' }>) {
    const i = this.cashDrops.findIndex((d) => d.id === msg.dropId);
    if (i < 0) return;
    this.cashDrops[i].dispose();
    this.cashDrops.splice(i, 1);
  }

  private onBankUpdate(msg: Extract<ServerMsg, { t: 'bankUpdate' }>) {
    if (!this.cashRules) return;
    this.cashRules.bank[1] = msg.bank1;
    this.cashRules.bank[2] = msg.bank2;
    if (this.buyMenu.isOpen) this.openBuyMenu();
  }

  private onLoadoutUpdate(msg: Extract<ServerMsg, { t: 'loadoutUpdate' }>) {
    const p = this.player;
    if (!p) return;
    for (const id of msg.weapons) {
      p.loadout.add(id);
      if (!p.inventory.has(id)) {
        p.inventory.add(id);
        p.ammo[id] = WEAPONS[id].startAmmo;
      }
    }
    p.armor = Math.max(p.armor, msg.armor);
    if (this.buyMenu.isOpen) this.openBuyMenu();
  }

  private onRemoteFire(msg: Extract<ServerMsg, { t: 'fire' }>) {
    const weapon = WEAPONS[msg.weapon];
    if (!weapon) return;
    const spec = msg.alt ? weapon.secondary : weapon.primary;
    if (!spec) return;

    const origin = new THREE.Vector3(msg.ox, msg.oy, msg.oz);
    const dir = new THREE.Vector3(msg.dx, msg.dy, msg.dz);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();

    this.effects.flash(origin.clone().addScaledVector(dir, 0.6), weapon.color, 0.5);
    const sfx = msg.weapon === 'pulse' ? (msg.alt ? 'orb' : 'pulse')
      : msg.weapon === 'shard' ? 'shard'
      : msg.weapon === 'rocket' ? 'rocket' : 'railgun';
    this.audio.play(sfx, origin);

    if (spec.kind === 'projectile') {
      const owner = this.remotes.get(msg.id);
      if (!owner) return;
      this.spawnProjectile({
        owner, kind: spec.projectileKind ?? 'rocket', weaponId: weapon.id,
        origin: origin.clone().addScaledVector(dir, 0.8), dir,
        speed: spec.projectileSpeed ?? 40, life: spec.projectileLife ?? 5,
        directDamage: 0, splashRadius: spec.splashRadius ?? 3, splashDamage: 0,
        knockback: 0, color: weapon.color, cosmetic: true,
        bounces: spec.bounces ?? 0,
      });
    } else {
      const range = spec.range ?? 200;
      const hit = this.physics.raycastWorld(origin, dir, range);
      const end = origin.clone().addScaledVector(dir, hit ? hit.toi : range);
      if (spec.kind === 'pellets') this.effects.tracer(origin, end, weapon.color);
      else this.effects.beam(origin, end, weapon.color, weapon.id === 'railgun' ? 0.1 : 0.045);
    }
  }

  private onNetKill(msg: Extract<ServerMsg, { t: 'kill' }>) {
    const victim = this.actorByNetId(msg.victimId);
    const killer = msg.killerId ? this.actorByNetId(msg.killerId) : null;
    if (victim) {
      this.effects.explosion(victim.position.clone(), 2.4, victim.colorHex);
      this.audio.play('die', victim.position);
    }
    this.hud.addKill(
      msg.killerId === 0 ? '☠' : (killer?.name ?? '?'),
      victim?.name ?? '?',
      WEAPON_LABEL[msg.weapon] ?? msg.weapon.toUpperCase(),
      killer === this.player,
      victim === this.player,
    );
    if (victim === this.player && this.player) {
      this.player.spree = 0;
      this.player.multiKill = 0;
      this.hud.showDamageFlash();
    }
    if (killer && killer === this.player && victim !== this.player) {
      const k = killer;
      this.hud.showHitmarker(true);
      k.multiKill = this.time - k.lastKillTime < 4 ? k.multiKill + 1 : 1;
      k.lastKillTime = this.time;
      k.spree++;
      const big = this.streakBig(k, msg.headshot);
      if (big) { this.hud.announce(big); this.audio.announce(big); }
    }
  }

  private onNetMatchOver(msg: Extract<ServerMsg, { t: 'matchOver' }>) {
    this.state = 'matchover';
    this.match.over = true;
    this.input.exitLock();
    this.audio.setMuffled(true);
    this.hud.setVisible(false);
    this.buyMenu.close();
    if (this.gameMode === 'cashraid' && this.cashRules) {
      this.cashRules.winner = msg.winnerTeam;
      const won = !!this.player && msg.winnerTeam === this.player.team;
      this.audio.announce(won ? 'You win' : msg.winnerTeam === 0 ? 'Draw' : 'Match over');
      this.menu.showCashRaidEnd(this.cashRules, this.actors, this.player!);
    } else {
      const winner = msg.winnerId ? this.actorByNetId(msg.winnerId) : null;
      this.audio.announce(winner === this.player ? 'You win' : 'Match over');
      this.menu.showEnd(this.match.ranking(this.actors), winner, this.player!);
    }
  }

  private onNetMatchReset(msg: Extract<ServerMsg, { t: 'matchReset' }>) {
    this.match.timeLeft = msg.match.timeLeft;
    this.match.over = false;
    this.firstBloodDone = false;
    if (this.cashRules) {
      this.cashRules.bank[1] = msg.match.bank1;
      this.cashRules.bank[2] = msg.match.bank2;
      this.cashRules.winner = 0;
      for (const d of this.cashDrops) d.dispose();
      this.cashDrops = [];
    }
    for (const a of this.actors) {
      a.moneyBanked = 0; a.moneyStolen = 0; a.carried = 0;
      if (this.gameMode === 'cashraid') a.loadout = new Set(['pulse']);
    }
    if (this.player) { this.player.spree = 0; this.player.multiKill = 0; }
    this.buyMenu.close();
    if (this.state === 'matchover') {
      this.state = 'playing';
      this.menu.hideAll();
      this.hud.setVisible(true);
      this.audio.setMuffled(false);
      this.input.requestLock();
      this.lastFrame = performance.now();
    }
  }

  private onNetClose() {
    if (this.mode !== 'online') return;
    this.clearMatch();
    this.state = 'menu';
    this.hud.setVisible(false);
    this.hud.hideRespawn();
    this.audio.setMuffled(false);
    this.menu.showOnlineHub('disconnected from server');
  }

  private actorByNetId(id: number): Actor | null {
    if (id === this.localId) return this.player;
    return this.remotes.get(id) ?? null;
  }

  private updateOnline(dt: number) {
    this.time += dt;
    this.shakeTrauma = Math.max(0, this.shakeTrauma - dt * 1.8);
    if (this.input.keyPressed('Escape')) {
      if (this.buyMenu.isOpen) this.buyMenu.close();
      else { this.pause(); return; }
    }

    const player = this.player!;
    player.update(dt);
    this.physics.step();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.projectiles[i].update(dt);
      if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
    }
    this.effects.update(dt);

    const renderTime = performance.now();
    for (const r of this.remotes.values()) r.tick(renderTime, dt);

    if (this.gameMode === 'cashraid') {
      for (const v of this.vaults) v.update(dt);
      for (const b of this.buyStations) b.update(dt);
      for (const d of this.cashDrops) d.update(dt);
      this.updateOnlineCashInteract();
    }

    this.inputAccum += dt;
    if (this.inputAccum >= 0.05 && this.net) {
      this.inputAccum = 0;
      this.sendInput();
    }

    if (!player.alive) this.hud.showRespawn('FRAGGED');
    else this.hud.hideRespawn();

    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    this.audio.updateListener(this.camera.position, fwd);

    this.hud.toggleScoreboard(this.input.key('Tab'), this.match, this.actors, player, this.cashRules);
    this.hud.update(player, this.match, this.actors, this.time, this.cashRules);
  }

  /** Online Cash Raid: buy menu + contextual prompts (server runs the channel). */
  private updateOnlineCashInteract() {
    const p = this.player;
    if (!p) return;
    if (!p.alive) {
      if (this.buyMenu.isOpen) this.buyMenu.close();
      this.hud.setPrompt('');
      return;
    }
    const atBuy = this.buyStations.some((b) => b.team === p.team && b.containsActor(p));
    if (this.buyMenu.isOpen) {
      if (this.input.keyPressed('KeyB') || !atBuy) this.buyMenu.close();
      else for (let i = 0; i < SHOP_ITEMS.length; i++) {
        if (this.input.keyPressed('Digit' + (i + 1))) this.tryBuy(SHOP_ITEMS[i]);
      }
    } else if (atBuy && this.input.keyPressed('KeyB')) {
      this.openBuyMenu();
    }

    const ownVault = this.vaults.find((v) => v.team === p.team && v.containsActor(p));
    const enemyVault = this.vaults.find((v) => v.team !== p.team && v.containsActor(p));
    if (this.buyMenu.isOpen) this.hud.setPrompt('');
    else if (ownVault && p.carried > 0 && this.input.key('KeyE')) this.hud.setPrompt('DEPOSITING…');
    else if (enemyVault && this.input.key('KeyE')) this.hud.setPrompt('RAIDING VAULT…');
    else if (ownVault && p.carried > 0) this.hud.setPrompt(`HOLD  E  TO DEPOSIT  $${Math.floor(p.carried).toLocaleString()}`);
    else if (enemyVault) this.hud.setPrompt('HOLD  E  TO RAID THE ENEMY VAULT');
    else if (atBuy) this.hud.setPrompt('PRESS  B  TO BUY');
    else this.hud.setPrompt('');
  }

  private sendInput() {
    const p = this.player!;
    let anim = 'Idle';
    if (!p.alive) anim = 'Death';
    else if (!p.grounded) anim = 'Jump';
    else if (Math.hypot(p.velocity.x, p.velocity.z) > 1.6) anim = 'Running';
    this.net!.send({
      t: 'input',
      x: p.position.x, y: p.position.y - ACTOR_FEET_OFFSET, z: p.position.z,
      yaw: p.yaw, pitch: p.pitch,
      vx: p.velocity.x, vy: p.velocity.y, vz: p.velocity.z,
      weapon: p.currentWeapon, anim,
      interact: this.gameMode === 'cashraid' && p.alive && this.input.key('KeyE'),
    });
  }

  private applyDamageOnline(target: Actor, info: DamageInfo) {
    if (target instanceof RemotePlayer) {
      // Cash Raid: don't report friendly fire — the server rejects it anyway
      if (this.gameMode === 'cashraid' && this.player && target.team === this.player.team) return;
      this.net?.send({
        t: 'hit', targetId: target.netId,
        amount: info.amount, weapon: info.weaponId, headshot: info.headshot,
      });
      this.effects.impact(info.point, new THREE.Vector3(0, 1, 0), 0xff5a5a);
      this.audio.play('hit', target.position);
      this.hud.showHitmarker(false);
      this.audio.play('hitmarker');
    } else if (target === this.player && info.knockback) {
      // server owns our health; keep knockback so rocket-jumps still feel good
      target.velocity.add(info.knockback);
    }
  }

  private radialDamageOnline(
    center: THREE.Vector3, radius: number, maxDamage: number,
    weaponId: string, knockback: number,
  ) {
    let hitSomeone = false;
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (this.gameMode === 'cashraid' && a instanceof RemotePlayer &&
          this.player && a.team === this.player.team) continue;
      const d = a.position.distanceTo(center);
      if (d > radius) continue;
      // Self-damage (rocket jumps) still applies — the blast starts at the
      // local player's feet so it has trivial LOS to them anyway.
      if (a !== this.player && !this.splashHasLineOfSight(center, a)) continue;
      const falloff = Math.pow(1 - d / radius, 0.6);
      if (a instanceof RemotePlayer) {
        this.net?.send({
          t: 'hit', targetId: a.netId,
          amount: maxDamage * falloff, weapon: weaponId, headshot: false,
        });
        hitSomeone = true;
      } else if (a === this.player) {
        const kb = a.position.clone().sub(center);
        kb.y += radius * 0.35;
        if (kb.lengthSq() < 1e-4) kb.set(0, 1, 0);
        a.velocity.addScaledVector(kb.normalize(), knockback * (0.45 + falloff));
      }
    }
    if (hitSomeone) { this.hud.showHitmarker(false); this.audio.play('hitmarker'); }
  }

  private onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }
}
