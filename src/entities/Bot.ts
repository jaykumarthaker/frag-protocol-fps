import * as THREE from 'three';
import { Actor } from './Actor';
import { BotBrain } from '../ai/BotBrain';
import { createCharacter, createHalo, type CharacterInstance, type CharacterAnim } from '../core/Models';
import { makeNameTag } from './nameTag';
import { createCashTag, type CashTag } from './cashTag';
import type { Game } from '../core/Game';
import type { MatchConfig } from '../core/types';

/** A computer-controlled actor; movement/aim/fire come from its BotBrain. */
export class Bot extends Actor {
  private brain: BotBrain;
  private robot: CharacterInstance;
  private cashTag: CashTag;
  /** Cash Raid: true when the bot is channelling a vault deposit / steal. */
  wantVaultInteract = false;

  constructor(
    game: Game, name: string, colorHex: number,
    spawnFeet: THREE.Vector3, difficulty: MatchConfig['difficulty'],
    characterId = 'robot',
  ) {
    super(game, name, colorHex, spawnFeet);
    this.isBot = true;
    this.characterId = characterId;
    this.brain = new BotBrain(this, game, difficulty);

    this.robot = createCharacter(
      characterId, colorHex, game.settings.quality === 'high',
    );
    this.mesh.add(this.robot.root);
    this.mesh.add(createHalo(colorHex));
    this.mesh.add(makeNameTag(this.name, colorHex));
    this.cashTag = createCashTag();
    this.mesh.add(this.cashTag.sprite);
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
    this.cashTag.setAmount(this.alive ? this.carried : 0);
    let anim: CharacterAnim;
    if (!this.alive) anim = 'Death';
    else if (!this.grounded) anim = 'Jump';
    else if (Math.hypot(this.velocity.x, this.velocity.z) > 1.6) anim = 'Running';
    else anim = 'Idle';
    this.robot.play(anim);
  }
}
