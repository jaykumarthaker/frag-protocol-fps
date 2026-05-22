import * as THREE from 'three';
import { Physics } from '../physics/Physics';
import { Arena } from '../arena/Arena';
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
import { HUD } from '../ui/HUD';
import { Menu, type GameSettings } from '../ui/Menu';
import { NetClient } from '../net/NetClient';
import type { ServerMsg, NetPlayer } from '../net/protocol';
import { WEAPONS } from '../weapons/Weapons';
import { loadModels } from './Models';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { DamageInfo, HitscanResult, MatchConfig, GameState } from './types';

const WEAPON_LABEL: Record<string, string> = {
  railgun: 'RAILGUN', shard: 'SHARD CANNON', rocket: 'ROCKET',
  pulse: 'PULSE RIFLE', pulse_combo: 'PULSE COMBO', void: 'THE VOID',
};

const BOT_NAMES = ['VEX', 'RAZE', 'NOVA', 'KILO', 'ZERO', 'ORYX', 'BANE'];
const BOT_COLORS = [0xff7a18, 0xff3b3b, 0xb98bff, 0x6dff8a, 0xffd23f, 0xff5ec4, 0x5ec8ff];

const RESPAWN_DELAY = 2.5;

/**
 * Central orchestrator: owns the renderer/scene/camera, all subsystems and
 * the game state machine (menu → playing → paused → matchover). Entities call
 * back into the public combat/spawn methods declared here.
 */
export class Game {
  renderer!: THREE.WebGLRenderer;
  composer!: EffectComposer;
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
  match!: Match;

  // online play
  mode: 'offline' | 'online' = 'offline';
  net: NetClient | null = null;
  localId = 0;
  remotes = new Map<number, RemotePlayer>();

  state: GameState = 'menu';
  time = 0;
  settings: GameSettings = { sensitivity: 1.0, volume: 0.7, fov: 95 };

  private lastFrame = 0;
  private menuTime = 0;
  private lastConfig: MatchConfig | null = null;
  private firstBloodDone = false;
  private parent!: HTMLElement;
  private inputAccum = 0;
  private onlineUrl = '';
  private onlineName = 'PLAYER';

  static async create(parent: HTMLElement): Promise<Game> {
    const g = new Game();
    g.parent = parent;

    g.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    g.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    g.renderer.setSize(window.innerWidth, window.innerHeight);
    g.renderer.shadowMap.enabled = true;
    g.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    g.menu = new Menu(parent, {
      settings: g.settings,
      onStart: (cfg) => g.startMatch(cfg),
      onResume: () => g.resume(),
      onRestart: () => g.restart(),
      onMainMenu: () => g.toMainMenu(),
      onConnectOnline: (url, name) => g.startOnline(url, name),
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

    const dir = new THREE.DirectionalLight(0xfff2e0, 1.85);
    dir.position.set(34, 54, 22);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    const c = dir.shadow.camera;
    c.left = -42; c.right = 42; c.top = 42; c.bottom = -42;
    c.near = 1; c.far = 140;
    dir.shadow.bias = -0.0009;
    this.scene.add(dir);
    this.scene.add(dir.target);

    const glow = new THREE.PointLight(0x36e0ff, 16, 70);
    glow.position.set(0, 15, 0);
    this.scene.add(glow);
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

  /** Bloom post-processing pipeline (makes emissive trims / FX glow). */
  private setupComposer() {
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
    this.composer.render();
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

    if (this.input.keyPressed('Escape')) { this.pause(); return; }

    const player = this.player!;
    player.update(dt);
    for (const bot of this.bots) bot.update(dt);

    this.physics.step();

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.projectiles[i].update(dt);
      if (this.projectiles[i].dead) this.projectiles.splice(i, 1);
    }
    for (const p of this.pickups) p.update(dt);
    this.effects.update(dt);
    this.updateRespawns();

    if (this.match.update(dt, this.actors)) { this.endMatch(); return; }

    // audio listener follows the camera
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    this.audio.updateListener(this.camera.position, fwd);

    for (const bot of this.bots) bot.syncMesh(dt);

    const showScores = this.input.key('Tab');
    this.hud.toggleScoreboard(showScores, this.match, this.actors, player);
    this.hud.update(player, this.match, this.actors, this.time);
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

  private startMatch(config: MatchConfig) {
    this.clearMatch();
    this.lastConfig = config;
    this.firstBloodDone = false;
    this.time = 0;
    this.match = new Match(config);

    const spawns = this.arena.spawnPoints;
    this.player = new Player(this, 'YOU', spawns[0], this.camera);
    this.actors.push(this.player);

    for (let i = 0; i < config.botCount; i++) {
      const bot = new Bot(
        this,
        BOT_NAMES[i % BOT_NAMES.length],
        BOT_COLORS[i % BOT_COLORS.length],
        spawns[(i + 1) % spawns.length],
        config.difficulty,
      );
      this.actors.push(bot);
      this.bots.push(bot);
      this.scene.add(bot.mesh);
    }

    for (const ps of this.arena.pickupSpawns) {
      this.pickups.push(new Pickup(this, ps.type, ps.pos));
    }
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

  private clearMatch() {
    this.net?.close();
    this.net = null;
    this.mode = 'offline';
    this.localId = 0;
    this.remotes.clear();
    this.player?.dispose();
    for (const a of this.actors) {
      this.scene.remove(a.mesh);
      this.physics.removeActor(a.body, a.collider);
    }
    for (const p of this.projectiles) p.dispose();
    for (const p of this.pickups) p.dispose();
    this.actors = [];
    this.bots = [];
    this.projectiles = [];
    this.pickups = [];
    this.player = null;
  }

  private restart() {
    if (this.mode === 'online') this.startOnline(this.onlineUrl, this.onlineName);
    else if (this.lastConfig) this.startMatch(this.lastConfig);
  }

  private endMatch() {
    this.state = 'matchover';
    this.input.exitLock();
    this.audio.setMuffled(true);
    this.hud.setVisible(false);
    const ranking = this.match.ranking(this.actors);
    this.audio.announce(this.match.winner === this.player ? 'You win' : 'Match over');
    this.menu.showEnd(ranking, this.match.winner, this.player!);
  }

  private pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.audio.setMuffled(true);
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
    a.respawn(this.chooseSpawn());
    this.effects.flash(a.position.clone(), a.colorHex, 2.2, 0.3);
    this.audio.play('spawn', a === this.player ? undefined : a.position);
  }

  /** Pick the spawn point furthest from currently-alive actors. */
  private chooseSpawn(): THREE.Vector3 {
    let best = this.arena.spawnPoints[0];
    let bestScore = -Infinity;
    for (const sp of this.arena.spawnPoints) {
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

  spawnProjectile(opts: ProjectileOpts) {
    this.projectiles.push(new Projectile(this, opts));
  }

  applyDamage(target: Actor, info: DamageInfo) {
    if (this.mode === 'online') { this.applyDamageOnline(target, info); return; }
    const res = target.takeDamage(info);
    if (res.dealt > 0) {
      this.effects.impact(info.point, new THREE.Vector3(0, 1, 0), 0xff5a5a);
      this.audio.play('hit', target.position);
      if (info.attacker === this.player && target !== this.player) {
        this.hud.showHitmarker(res.died);
        if (!res.died) this.audio.play('hitmarker');
      }
      if (target === this.player) this.hud.showDamageFlash();
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
      const d = a.position.distanceTo(center);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
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
  //  online play
  // ===================================================================

  private async startOnline(url: string, name: string) {
    this.clearMatch();
    this.onlineUrl = url;
    this.onlineName = (name || 'PLAYER').toUpperCase().slice(0, 14);
    this.menu.showConnecting();

    const net = new NetClient();
    net.onMessage = (m) => this.handleNet(m);
    net.onClose = () => this.onNetClose();
    try {
      await net.connect(url, this.onlineName);
    } catch (e) {
      this.menu.showOnline(e instanceof Error ? e.message : 'connection failed');
      return;
    }
    this.net = net;
    // setup completes when the 'welcome' message arrives
  }

  private handleNet(msg: ServerMsg) {
    switch (msg.t) {
      case 'welcome':      this.onWelcome(msg); break;
      case 'state':        this.onNetState(msg); break;
      case 'playerJoined': this.addRemote(msg.player); break;
      case 'playerLeft':   this.removeRemote(msg.id); break;
      case 'fire':         this.onRemoteFire(msg); break;
      case 'kill':         this.onNetKill(msg); break;
      case 'spawn':        this.onNetSpawn(msg); break;
      case 'matchOver':    this.onNetMatchOver(msg); break;
      case 'matchReset':   this.onNetMatchReset(msg); break;
    }
  }

  private onWelcome(msg: Extract<ServerMsg, { t: 'welcome' }>) {
    this.mode = 'online';
    this.localId = msg.id;
    this.time = 0;
    this.firstBloodDone = false;
    this.match = new Match({
      botCount: 0, fragLimit: msg.match.fragLimit,
      timeLimitSec: msg.match.timeLeft, difficulty: 'skilled',
    });
    this.match.timeLeft = msg.match.timeLeft;

    const me = msg.players.find((p) => p.id === this.localId);
    const feet = me
      ? new THREE.Vector3(me.x, me.y, me.z)
      : this.arena.spawnPoints[0].clone();
    this.player = new Player(this, this.onlineName, feet, this.camera);
    this.actors.push(this.player);
    this.player.respawn(feet); // populates the weapon inventory

    for (const np of msg.players) {
      if (np.id !== this.localId) this.addRemote(np);
    }
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
    for (const np of msg.players) {
      if (np.id === this.localId) {
        const p = this.player;
        if (!p) continue;
        p.health = np.health;
        p.armor = np.armor;
        p.frags = np.frags;
        p.deaths = np.deaths;
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
    const winner = msg.winnerId ? this.actorByNetId(msg.winnerId) : null;
    this.audio.announce(winner === this.player ? 'You win' : 'Match over');
    this.menu.showEnd(this.match.ranking(this.actors), winner, this.player!);
  }

  private onNetMatchReset(msg: Extract<ServerMsg, { t: 'matchReset' }>) {
    this.match.timeLeft = msg.match.timeLeft;
    this.match.over = false;
    this.firstBloodDone = false;
    if (this.player) { this.player.spree = 0; this.player.multiKill = 0; }
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
    this.menu.showOnline('disconnected from server');
  }

  private actorByNetId(id: number): Actor | null {
    if (id === this.localId) return this.player;
    return this.remotes.get(id) ?? null;
  }

  private updateOnline(dt: number) {
    this.time += dt;
    if (this.input.keyPressed('Escape')) { this.pause(); return; }

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

    this.hud.toggleScoreboard(this.input.key('Tab'), this.match, this.actors, player);
    this.hud.update(player, this.match, this.actors, this.time);
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
    });
  }

  private applyDamageOnline(target: Actor, info: DamageInfo) {
    if (target instanceof RemotePlayer) {
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
      const d = a.position.distanceTo(center);
      if (d > radius) continue;
      const falloff = 1 - d / radius;
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
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }
}
