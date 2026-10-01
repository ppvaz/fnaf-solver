// g575-g595: the shared attack counter and the animation-finished exits.
// Sprite timing here is the rebuilt runtime's fixed 60 Hz Active clock, not
// an assertion about the retail animation clock. Metadata and the two exits
// are retained in full06-terminal-clock-20260930.json.
import { INSIDE_ATTACK_FRAMES } from './config.ts';
import type { Sim } from './plant-model.ts';
export type AttackAnimation = { who: string; reason: string; count: number; spriteCounter: number;
  spriteFrame: number; speed: number; frames: number | null; started: number };

// The three looping attack sprites terminate through g588, not AnimationFinished.
const SPRITES: Record<string, [number, number | null]> = ({
  withfreddy: [50, null], withbonnie: [50, 16], withchica: [40, null],
  toyfreddy: [40, null], toybonnie: [50, 13], toychica: [40, 13],
  mangle: [50, 16], puppet: [50, 15], golden: [40, 13],
});

/** AnimationFinished dispatch precedes the ordinary event sheet. */
export function attackAnimationEarly(sim: Sim) {
  const a = sim.attackAnimation;
  if (!sim.opts.sourcedAttackAnimation || !a || a.frames === null) return false;
  a.spriteCounter += a.speed;
  while (a.spriteCounter > 100) {
    a.spriteCounter -= 100;
    if (++a.spriteFrame === a.frames) {
      sim.kill(a.reason, `${a.who} completed the rebuilt attack animation`);
      return true;
    }
  }
  return false;
}

/** g575 selects a committed attack; g587 adds value 5 and g588 reads it. */
export function attackAnimationLate(sim: Sim) {
  if (!sim.opts.sourcedAttackAnimation) return;
  if (!sim.attackAnimation) {
    const u = sim.units.find(unit => unit.committedAt >= 0);
    const who = u?.id ?? (sim.puppetAttackExecuting ? 'puppet' : sim.goldenHallAttackExecuting ? 'golden' : null);
    if (!who) return;
    const [speed, frames] = SPRITES[who];
    // Active's idle one-frame animation has finished with counter=100. ForceAnimation
    // resets its frame and loop count, but carries that counter into the attack.
    sim.attackAnimation = { who, reason: u ? 'inside-office' : who === 'puppet' ? 'puppet' : 'golden-freddy-hall',
      count: 0, spriteCounter: 100, spriteFrame: 0, speed, frames, started: sim.frame };
  }
  sim.attackAnimation.count += sim.value5(sim.frame);
  if (sim.attackAnimation.count >= INSIDE_ATTACK_FRAMES)
    sim.kill(sim.attackAnimation.reason, `${sim.attackAnimation.who} reached the shared attack counter limit`);
}
