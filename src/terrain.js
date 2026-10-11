// Relevo do mundo, pontos de interesse e colisão.
import { fbm, smooth, segDist } from './util.js';

export const WORLD = 62;
export const LAKE = { x: -20, z: 10, r: 17 };
export const VILLAGE = { x: 12, z: -4 };
export const RUINS = { x: -6, z: -38 };
export const DOCK = { x1: 0, x2: 0, z1: 6.8, z2: 8.2, y: 0.32 };
export const PATHS = [[12, -4, -6, -30], [12, -4, -3, 7.5], [12, -4, 40, 2]];
export const FIRE = { x: VILLAGE.x + 5, z: VILLAGE.z + 4 };
export const SPAWN = { x: FIRE.x - 2, z: FIRE.z + 1.5 };
export const ELDER = { x: VILLAGE.x - 3, z: VILLAGE.z + 2.5 };

export function heightAt(x, z) {
  let h = fbm(x * 0.035 + 3.1, z * 0.035 + 7.7) * 7 - 0.4;
  h -= smooth(LAKE.r, 3, Math.hypot((x - LAKE.x) * 0.9, z - LAKE.z)) * 6.5;
  const fv = smooth(21, 12, Math.hypot(x - VILLAGE.x, z - VILLAGE.z)); h = h * (1 - fv) + 1.0 * fv;
  const fr = smooth(13, 6, Math.hypot(x - RUINS.x, z - RUINS.z)); h = h * (1 - fr) + 1.6 * fr;
  const de = Math.max(Math.abs(x), Math.abs(z));
  h += Math.max(0, de - 50) * 0.9;
  return h;
}

// o cais começa onde a margem encontra a água e avança lago adentro
{
  let x = -2;
  while (heightAt(x, 7.5) > 0.4 && x > -30) x -= 0.25;
  DOCK.x2 = x + 1.5; DOCK.x1 = x - 8;
  PATHS[1][2] = DOCK.x2 + 0.5;
}

export const onDock = (x, z) => x > DOCK.x1 && x < DOCK.x2 && z > DOCK.z1 && z < DOCK.z2;
export const groundY = (x, z) => onDock(x, z) ? Math.max(heightAt(x, z), DOCK.y) : heightAt(x, z);
export const pathDist = (x, z) => Math.min(...PATHS.map(p => segDist(x, z, ...p)));

export const colliders = [];
export function canStand(x, z, r) {
  if (Math.abs(x) > WORLD - 2 || Math.abs(z) > WORLD - 2) return false;
  const h = heightAt(x, z);
  if (!onDock(x, z) && (h < -0.35 || h > 7.5)) return false;
  for (const c of colliders) {
    const dx = x - c.x, dz = z - c.z;
    if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return false;
  }
  return true;
}
export function moveEntity(o, dx, dz, r) {
  if (canStand(o.x + dx, o.z + dz, r)) { o.x += dx; o.z += dz; return true; }
  if (Math.abs(dx) > 1e-4 && canStand(o.x + dx, o.z, r)) { o.x += dx; return true; }
  if (Math.abs(dz) > 1e-4 && canStand(o.x, o.z + dz, r)) { o.z += dz; return true; }
  return false;
}
