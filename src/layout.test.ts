import { describe, it, expect } from 'vitest';
import { validateLayout, encodeLayout, decodeLayout, parseTable, exportTable, importTable, TABLES } from './layout';

it('round-trips the exact count/kind/x/y byte format and rejects truncated or malicious inputs', () => {
  const parts = [{kind:0 as const,x:70,y:60},{kind:1 as const,x:130,y:100},{kind:2 as const,x:190,y:70}];
  expect(Array.from(encodeLayout(parts))).toEqual([3,0,70,60,1,130,100,2,190,70]);
  expect(decodeLayout(encodeLayout(parts))).toEqual(parts);
  expect(() => decodeLayout(new Uint8Array([3,0,70]))).toThrow();
  expect(() => decodeLayout(new Uint8Array([0]))).toThrow();
  expect(() => encodeLayout([{kind:0,x:1,y:2},...parts])).toThrow();
  const table = {version:1 as const,title:'Copper & cream',parts};
  expect(parseTable(JSON.stringify(table))).toEqual(table);
  expect(importTable(exportTable(table))).toEqual(table);
  expect(() => parseTable('{"version":2}')).toThrow(/version/i);
  expect(() => parseTable('{"version":1,"title":"","parts":[]}')).toThrow();
  expect(() => importTable('not valid')).toThrow();
  expect(TABLES.length).toBeGreaterThanOrEqual(2);
  TABLES.forEach(t => expect(validateLayout(t.parts)).toEqual([]));
});

describe('layout rules', () => {
  it('accepts 3 separated in-bounds parts and rejects invalid trust-boundary data', () => {
    const valid = [{kind:0,x:70,y:60},{kind:1,x:130,y:100},{kind:2,x:190,y:70}];
    expect(validateLayout(valid)).toEqual([]);
    expect(validateLayout(valid.slice(0,2)).join()).toMatch(/3.*12/);
    expect(validateLayout([...valid,...Array.from({length:10},()=>valid[0])]).join()).toMatch(/3.*12/);
    for (const bad of [{kind:3,x:80,y:50},{kind:0,x:27,y:50},{kind:0,x:228,y:50},{kind:0,x:70,y:23},{kind:0,x:70,y:191},{kind:0,x:NaN,y:50},{kind:0,x:70.5,y:50}]) {
      expect(validateLayout([bad,...valid.slice(1)]).length).toBeGreaterThan(0);
    }
    expect(validateLayout([valid[0],{kind:1,x:85,y:60},valid[2]]).join()).toMatch(/overlap/i);
    expect(validateLayout([valid[0],{kind:1,x:86,y:60},valid[2]])).toEqual([]);
    expect(validateLayout(null).length).toBeGreaterThan(0);
  });
});
