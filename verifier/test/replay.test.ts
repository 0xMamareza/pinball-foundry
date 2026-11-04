import { describe, expect, it } from 'vitest';
import { createGame, launch, step } from '../../src/engine';
import { TABLES } from '../../src/layout';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { officialTables, replay, MAX_STEPS, ENGINE_SHA256, LAYOUT_SHA256 } from '../src/replay';

export function completeProof(index = 0) {
  const game = createGame(TABLES[index].parts);
  const inputs: number[] = [];
  const launches: { step: number; power: number }[] = [];
  while (game.status !== 'over' && inputs.length < MAX_STEPS) {
    if (game.status === 'ready') {
      launches.push({ step: inputs.length, power: 500 });
      launch(game, .5);
    }
    inputs.push(0);
    step(game, { left: false, right: false });
  }
  if (game.status !== 'over') throw new Error('fixture did not finish');
  return { proof: { version: 1, inputs, launches }, score: game.score };
}

describe('authoritative replay', () => {
  it('pins the exact shared engine and layout sources for this ruleset', () => {
    for (const [file, expected] of [['engine', ENGINE_SHA256], ['layout', LAYOUT_SHA256]]) {
      expect(createHash('sha256').update(readFileSync(new URL(`../../src/${file}.ts`, import.meta.url))).digest('hex')).toBe(expected);
    }
  });
  it('replays both official tables to a complete three-ball finish', () => {
    for (const [i, table] of officialTables().entries()) {
      const { proof, score } = completeProof(i);
      expect(replay(table.tableId, 'standard', proof).score).toBe(score);
    }
  });
  it.each([
    ['negative launch step', (p: any) => { p.launches[0].step = -1; }],
    ['fractional launch step', (p: any) => { p.launches[0].step = .5; }],
    ['null launch', (p: any) => { p.launches[0] = null; }],
    ['empty inputs', (p: any) => { p.inputs = []; }],
    ['missing launch', (p: any) => { p.launches.pop(); }],
    ['unfinished', (p: any) => { p.inputs.pop(); }],
    ['extra steps', (p: any) => { p.inputs.push(0); }],
    ['too many steps', (p: any) => { p.inputs = Array(MAX_STEPS + 1).fill(0); }],
    ['claimed score', (p: any) => { p.score = 999999; }],
    ['wrong version', (p: any) => { p.version = 2; }],
    ['invalid mask', (p: any) => { p.inputs[0] = 4; }],
    ['noninteger mask', (p: any) => { p.inputs[0] = .5; }],
    ['string mask', (p: any) => { p.inputs[0] = '0'; }],
    ['nonfinite power', (p: any) => { p.launches[0].power = NaN; }],
    ['out of range power', (p: any) => { p.launches[0].power = 1001; }],
    ['fraction power', (p: any) => { p.launches[0].power = .5; }],
    ['launch while playing', (p: any) => { p.launches[1].step = 1; }],
    ['duplicate launch', (p: any) => { p.launches[1].step = 0; }],
    ['unsorted launches', (p: any) => { p.launches.reverse(); }],
    ['trailing launch', (p: any) => { p.launches[2].step = p.inputs.length; }],
    ['extra launch field', (p: any) => { p.launches[0].score = 9; }],
  ])('rejects %s', (_, mutate) => {
    const { proof } = completeProof();
    mutate(proof);
    expect(() => replay(officialTables()[0].tableId, 'standard', proof)).toThrow();
  });
  it('replays varied powers, ready-state flippers and per-step inputs exactly', () => {
    for (const [index, table] of officialTables().entries()) {
      const game = createGame(TABLES[index].parts, null);
      const inputs:number[] = [];
      const launches:{step:number;power:number}[] = [];
      let waiting = 0;
      while (game.status !== 'over' && inputs.length < MAX_STEPS) {
        if (game.status === 'ready' && ++waiting > 15) {
          const power = [0, 721, 1000][launches.length];
          launches.push({step:inputs.length,power});
          launch(game,power/1000);
          waiting=0;
        }
        const mask = (inputs.length % 120 < 30 ? 1 : 0) | (inputs.length % 173 < 40 ? 2 : 0);
        inputs.push(mask);
        step(game,{left:!!(mask&1),right:!!(mask&2)});
      }
      expect(game.status).toBe('over');
      const proof = {version:1,inputs,launches};
      expect(replay(table.tableId,'standard',proof).score).toBe(game.score);
      const reordered = {launches:launches.map(a=>({power:a.power,step:a.step})),inputs,version:1};
      expect(replay(table.tableId,'standard',reordered)).toEqual(replay(table.tableId,'standard',proof));
    }
  });
  it('rejects unrecognized variants, custom tables and null proofs', () => {
    const { proof } = completeProof();
    expect(() => replay(officialTables()[0].tableId, 'charged', proof)).toThrow();
    expect(() => replay('0x' + 'ff'.repeat(32), 'standard', proof)).toThrow();
    expect(() => replay(officialTables()[0].tableId, 'standard', null)).toThrow();
  });
  it('reconstructs a complete official run, ignoring no client state', () => {
    const { proof, score } = completeProof();
    const result = replay(officialTables()[0].tableId, 'standard', proof);
    expect(result.score).toBe(score);
    expect(result.steps).toBe(proof.inputs.length);
    expect(replay(officialTables()[0].tableId, 'standard', proof)).toEqual(result);
  });
});
