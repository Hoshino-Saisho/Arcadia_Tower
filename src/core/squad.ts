import type { CharacterDef } from './types';

/** 编队最多的角色数量 */
export const SQUAD_SIZE = 12;

/**
 * 玩家的编队（按编队顺序）：还没有编队、或编队里的角色都已经被删除时 = 前 12 个角色。
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
 * 编队里没有本关可用的角色时，改用本关指定的角色（前 12 个），fallback = true。
 */
export function battleRoster(characters: CharacterDef[], squad: string[], available: string[]): { roster: CharacterDef[]; fallback: boolean } {
  const team = resolveSquad(characters, squad);
  if (!available.length) return { roster: team, fallback: false };
  const inTeam = team.filter((c) => available.includes(c.id));
  if (inTeam.length) return { roster: inTeam, fallback: false };
  return { roster: characters.filter((c) => available.includes(c.id)).slice(0, SQUAD_SIZE), fallback: true };
}
