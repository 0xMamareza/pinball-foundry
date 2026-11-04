import { createGame, launch, step } from '../../src/engine';
import { TABLES } from '../../src/layout';
export function completeProof(index = 0) {
  const game = createGame(TABLES[index].parts);
  const inputs: number[] = [];
  const launches: { step: number; power: number }[] = [];
  while (game.status !== 'over' && inputs.length < 72_000) {
    if (game.status === 'ready') {
      launches.push({ step: inputs.length, power: 500 });
      launch(game, .5);
    }
    inputs.push(0);
    step(game, { left: false, right: false });
  }
  if (game.status !== 'over') throw new Error('fixture did not finish');
  return { proof: { version: 1 as const, inputs, launches }, score: game.score };
}
