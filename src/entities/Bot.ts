import * as THREE from 'three';
import { Actor } from './Actor';
import { BotBrain } from '../ai/BotBrain';
import { createRobot, type RobotInstance, type RobotAnim } from '../core/Models';
import type { Game } from '../core/Game';
import type { MatchConfig } from '../core/types';

/** A computer-controlled actor; movement/aim/fire come from its BotBrain. */
export class Bot extends Actor {
  private brain: BotBrain;
  private robot: RobotInstance;
  /** Cash Raid: true when the bot is channelling a vault deposit / steal. */
  wantVaultInteract = false;

  constructor(
    game: Game, name: string, colorHex: number,
    spawnFeet: THREE.Vector3, difficulty: MatchConfig['difficulty'],
  ) {
    super(game, name, colorHex, spawnFeet);
    this.isBot = true;
    this.brain = new BotBrain(this, game, difficulty);

    this.robot = createRobot(colorHex);
    this.mesh.add(this.robot.root);
    this.mesh.add(this.makeNameTag());
  }

  private makeNameTag(): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.font = 'bold 34px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(8,12,20,0.7)';
    ctx.fillRect(0, 8, 256, 48);
    ctx.fillStyle = '#' + this.colorHex.toString(16).padStart(6, '0');
    ctx.fillText(this.name.toUpperCase(), 128, 33);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.position.y = 2.15;
    spr.scale.set(2.4, 0.6, 1);
    return spr;
  }

  update(dt: number) {
    if (!this.alive) { this.wantVaultInteract = false; return; }
    const intent = this.brain.update(dt);
    this.wantVaultInteract = this.brain.wantInteract;
    this.move(dt, intent.wishDir, intent.jump, intent.dodge);
  }

  protected override updateVisual(dt: number) {
    this.robot.setWeapon(this.currentWeapon);
    this.robot.update(dt);
    let anim: RobotAnim;
    if (!this.alive) anim = 'Death';
    else if (!this.grounded) anim = 'Jump';
    else if (Math.hypot(this.velocity.x, this.velocity.z) > 1.6) anim = 'Running';
    else anim = 'Idle';
    this.robot.play(anim);
  }
}
