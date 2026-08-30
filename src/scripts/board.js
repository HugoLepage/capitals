// Board geometry: 7 columns of flat-top hexes, heights alternating 6/7.
// Even columns (height 6) sit half a hex lower than odd columns (height 7).

export const COL_HEIGHTS = [6, 7, 6, 7, 6, 7, 6];

export const TILES = [];
const byColRow = new Map();

{
  let id = 0;
  COL_HEIGHTS.forEach((h, col) => {
    for (let row = 0; row < h; row++) {
      // y is the vertical position in hex-height units (for rendering)
      const y = row + (h === 6 ? 0.5 : 0);
      TILES.push({ id, col, row, y });
      byColRow.set(`${col},${row}`, id);
      id++;
    }
  });
}

export const TILE_COUNT = TILES.length;

const NEIGHBORS = TILES.map(({ col, row }) => {
  const shifted = COL_HEIGHTS[col] === 6; // short columns sit half a hex lower
  const deltas = shifted
    ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
    : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
  return deltas
    .map(([dc, dr]) => byColRow.get(`${col + dc},${row + dr}`))
    .filter((n) => n !== undefined);
});

export const neighborsOf = (id) => NEIGHBORS[id];
export const idAt = (col, row) => byColRow.get(`${col},${row}`);

// Starting base tiles, mirrored across the board center.
export const BASES = [idAt(1, 1), idAt(5, 5)];

// Breadth-first distance from a set of start tiles, walking only tiles for
// which `passable(id)` is true (start tiles themselves need not be passable).
// Returns an array of distances (Infinity where unreachable).
export function bfsDistances(startIds, passable) {
  const dist = new Array(TILE_COUNT).fill(Infinity);
  const queue = [];
  for (const id of startIds) {
    dist[id] = 0;
    queue.push(id);
  }
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const n of neighborsOf(id)) {
      if (dist[n] === Infinity && passable(n)) {
        dist[n] = dist[id] + 1;
        queue.push(n);
      }
    }
  }
  return dist;
}
