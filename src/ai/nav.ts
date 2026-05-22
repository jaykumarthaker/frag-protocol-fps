import * as THREE from 'three';

/**
 * A* over the arena waypoint graph. Returns a list of waypoint indices from
 * `start` to `goal` (inclusive), or an empty array if unreachable.
 */
export function findPath(
  waypoints: THREE.Vector3[],
  links: number[][],
  start: number,
  goal: number,
): number[] {
  if (start < 0 || goal < 0) return [];
  if (start === goal) return [start];

  const open = new Set<number>([start]);
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>([[start, 0]]);
  const h = (i: number) => waypoints[i].distanceTo(waypoints[goal]);
  const fScore = new Map<number, number>([[start, h(start)]]);

  while (open.size > 0) {
    let current = -1;
    let bestF = Infinity;
    for (const n of open) {
      const f = fScore.get(n) ?? Infinity;
      if (f < bestF) { bestF = f; current = n; }
    }

    if (current === goal) {
      const path = [current];
      let c = current;
      while (cameFrom.has(c)) { c = cameFrom.get(c)!; path.push(c); }
      return path.reverse();
    }

    open.delete(current);
    for (const next of links[current]) {
      const tentative = (gScore.get(current) ?? Infinity) +
        waypoints[current].distanceTo(waypoints[next]);
      if (tentative < (gScore.get(next) ?? Infinity)) {
        cameFrom.set(next, current);
        gScore.set(next, tentative);
        fScore.set(next, tentative + h(next));
        open.add(next);
      }
    }
  }
  return [];
}

/** Index of the waypoint nearest to `pos`. */
export function nearestWaypoint(waypoints: THREE.Vector3[], pos: THREE.Vector3): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const d = waypoints[i].distanceToSquared(pos);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
