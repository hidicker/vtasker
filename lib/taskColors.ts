// Okabe–Ito derived categorical palette: chosen because it stays distinguishable
// for the common forms of colour blindness, and every entry holds up against both
// the light street tiles and the darker topo/satellite layers.
const PALETTE = [
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#009E73', // green
  '#CC79A7', // pink
  '#E69F00', // orange
  '#56B4E9', // sky
  '#8C5AC8', // purple
  '#B23B3B', // brick
];

function hashIndex(taskId: string): number {
  let hash = 0;
  for (let i = 0; i < taskId.length; i++) {
    hash = (hash * 31 + taskId.charCodeAt(i)) >>> 0;
  }
  return hash % PALETTE.length;
}

/**
 * Stable colour for a task: the same task always gets the same colour, in any
 * session and regardless of list order or filtering, so a route people have seen
 * before stays recognisable.
 */
export function colorForTask(taskId: string): string {
  return PALETTE[hashIndex(taskId)];
}

/**
 * Colours for a whole set of tasks drawn together. Each task keeps its stable
 * colour where it can, but when two tasks on screen at once would hash to the
 * same swatch the later one is nudged to the next free slot — on a map, telling
 * neighbouring routes apart matters more than perfect cross-session stability.
 * Beyond PALETTE.length tasks collisions are unavoidable and we let them repeat.
 */
export function assignTaskColors(taskIds: string[]): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<number>();

  for (const id of taskIds) {
    const preferred = hashIndex(id);
    let index = preferred;
    for (let step = 0; step < PALETTE.length && used.has(index); step++) {
      index = (preferred + step + 1) % PALETTE.length;
    }
    used.add(index);
    assigned.set(id, PALETTE[index]);
  }
  return assigned;
}
