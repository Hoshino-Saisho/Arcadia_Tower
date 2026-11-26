import type { CharacterDef } from './types';

/** 编队最多的角色数量 */
export const SQUAD_SIZE = 12;

/**
 * 玩家的编队（按编队顺序）：还没有编队、或编队里的角色都已经被删除时 = 前 12 个角色。
 * characters 传入玩家已拥有的角色（没有获得的角色不能出战）。
 */
export function resolveSquad(characters: CharacterDef[], squad: string[]): CharacterDef[] {
  const byId = new Map(characters.map((c) => [c.id, c]));
  const list = squad
    .map((id) => byId.get(id))
    .filter((c): c is CharacterDef => !!c)
    .slice(0, SQUAD_SIZE);
  return list.length ? list : characters.slice(0, SQUAD_SIZE);
}

/**
 * 战斗中可以部署的角色 = 编队 ∩ 本关可用角色（按编队顺序）。
 * 编队里没有本关可用的角色时，改用本关指定的角色（前 12 个，优先用已拥有的），fallback = true。
 * owned = 已拥有的角色；all = 全部角色（本关指定的角色都没有获得时使用）。
 */
export function battleRoster(owned: CharacterDef[], squad: string[], available: string[], all: CharacterDef[] = owned): { roster: CharacterDef[]; fallback: boolean } {
  const team = resolveSquad(owned, squad);
  if (!available.length) return { roster: team, fallback: false };
  const inTeam = team.filter((c) => available.includes(c.id));
  if (inTeam.length) return { roster: inTeam, fallback: false };
  const mine = owned.filter((c) => available.includes(c.id));
  if (mine.length) return { roster: mine.slice(0, SQUAD_SIZE), fallback: true };
  return { roster: all.filter((c) => available.includes(c.id)).slice(0, SQUAD_SIZE), fallback: true };
}
