export type Part = { kind: 0 | 1 | 2; x: number; y: number };
export type Table = { version: 1; title: string; parts: Part[] };
export const PART_NAMES = ['Bumper', 'Spinner', 'Target'] as const;
export const TABLES: Table[] = [
  { version: 1, title: 'Copperwheel Works', parts: [
    {kind:0,x:91,y:66},{kind:0,x:164,y:66},{kind:0,x:128,y:99},
    {kind:1,x:128,y:39},{kind:2,x:52,y:119},{kind:2,x:202,y:119},
    {kind:1,x:85,y:154},{kind:1,x:170,y:154} ] },
  { version: 1, title: 'Midnight Assembly', parts: [
    {kind:0,x:77,y:67},{kind:0,x:179,y:67},{kind:1,x:128,y:92},
    {kind:0,x:92,y:130},{kind:0,x:165,y:130},{kind:2,x:128,y:40},
    {kind:2,x:53,y:170},{kind:2,x:202,y:170},{kind:1,x:128,y:170} ] },
];
export function encodeLayout(parts: Part[]): Uint8Array {
  const errors = validateLayout(parts);
  if (errors.length) throw new Error(errors[0]);
  return new Uint8Array([parts.length, ...parts.flatMap(p => [p.kind, p.x, p.y])]);
}
export function decodeLayout(bytes: Uint8Array): Part[] {
  if (bytes.length !== 1 + bytes[0] * 3) throw new Error('Invalid layout byte length.');
  const parts = Array.from({length:bytes[0]}, (_, i) => ({kind:bytes[i * 3 + 1] as Part['kind'], x:bytes[i * 3 + 2], y:bytes[i * 3 + 3]}));
  const errors = validateLayout(parts);
  if (errors.length) throw new Error(errors[0]);
  return parts;
}
export function parseTable(raw: string): Table {
  if (raw.length > 8000) throw new Error('Table is too large.');
  const data = JSON.parse(raw);
  if (!data || data.version !== 1) throw new Error('Unsupported table version.');
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 48) throw new Error('Use a title of 1–48 characters.');
  const errors = validateLayout(data.parts);
  if (errors.length) throw new Error(errors[0]);
  return {version:1, title:data.title.trim(), parts:data.parts.map((p: Part) => ({kind:p.kind,x:p.x,y:p.y}))};
}
export function exportTable(table: Table): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(parseTable(JSON.stringify(table)))))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function importTable(code: string): Table {
  if (code.length > 10000 || !/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('Invalid table link.');
  return parseTable(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(code.replaceAll('-','+').replaceAll('_','/')), c => c.charCodeAt(0))));
}
export function validateLayout(parts: unknown): string[] {
  if (!Array.isArray(parts) || parts.length < 3 || parts.length > 12) return ['Use 3–12 parts per table.'];
  const errors: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p || ![0, 1, 2].includes(p.kind) || !Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 28 || p.x > 227 || p.y < 24 || p.y > 190) {
      errors.push(`Part ${i + 1}: use a valid kind and integer coordinates x 28–227, y 24–190.`);
      continue;
    }
    for (let j = 0; j < i; j++) {
      if (parts[j] && Math.hypot(p.x - parts[j].x, p.y - parts[j].y) < 16) errors.push(`Parts ${j + 1} and ${i + 1} overlap; leave 16 grid units.`);
    }
  }
  return errors;
}
