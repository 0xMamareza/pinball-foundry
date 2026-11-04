import { keccak256, stringToHex } from 'viem';
import { createGame, launch, step } from '../../src/engine';
import { TABLES } from '../../src/layout';

export const MAX_STEPS = 72_000;
export const ENGINE_SHA256 = '3a1306b0d9c803b603d075547c63fa772bf3585da0dd6c4cd8b0280bf19ef495';
export const LAYOUT_SHA256 = '884ae0c12f64a261447bd786499a494c611495cd031cc8ce189544c1c0d60c52';
export const RULESET = keccak256(stringToHex(`PinballFoundry/replay-v1/${ENGINE_SHA256}/${LAYOUT_SHA256}/standard/launch-milli/72000`));
export type Proof = { version: 1; inputs: number[]; launches: { step: number; power: number }[] };

export function officialTables() {
  return TABLES.map((table, index) => ({
    tableId: keccak256(stringToHex(JSON.stringify({ ruleset: RULESET, parts: table.parts, variant: 'standard' }))),
    title: table.title, index, variant: 'standard' as const, ruleset: RULESET,
  }));
}

export function exactObject(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) {
    throw new Error('invalid object fields');
  }
}

export function replay(tableId: string, variant: string, proof: unknown) {
  const table = officialTables().find(t => t.tableId === tableId);
  if (!table || variant !== 'standard') throw new Error('unsupported table or variant');
  exactObject(proof, ['version', 'inputs', 'launches']);
  if (proof.version !== 1 || !Array.isArray(proof.inputs) || !proof.inputs.length ||
      proof.inputs.length > MAX_STEPS || !proof.inputs.every(m => Number.isInteger(m) && m >= 0 && m <= 3) ||
      !Array.isArray(proof.launches) || proof.launches.length !== 3) throw new Error('invalid proof bounds');
  let previous = -1;
  for (const a of proof.launches) {
    exactObject(a, ['step', 'power']);
    if (!Number.isInteger(a.step) || (a.step as number) <= previous || (a.step as number) >= proof.inputs.length ||
        !Number.isInteger(a.power) || (a.power as number) < 0 || (a.power as number) > 1000) throw new Error('invalid launch');
    previous = a.step as number;
  }
  const p = proof as unknown as Proof;
  const game = createGame(TABLES[table.index].parts, null);
  let action = 0;
  for (let i = 0; i < p.inputs.length; i++) {
    if (game.status === 'over') throw new Error('trailing steps');
    if (p.launches[action]?.step === i) {
      if (game.status !== 'ready') throw new Error('launch while playing');
      launch(game, p.launches[action++].power / 1000);
    }
    step(game, { left: !!(p.inputs[i] & 1), right: !!(p.inputs[i] & 2) });
  }
  if (game.status !== 'over' || game.lives !== 0 || action !== 3 || !Number.isSafeInteger(game.score)) throw new Error('unfinished run');
  const proofHash = keccak256(stringToHex(JSON.stringify({ version: 1, inputs: p.inputs, launches: p.launches.map(a => ({step:a.step,power:a.power})) })));
  return { score: game.score, steps: p.inputs.length, proofHash };
}
