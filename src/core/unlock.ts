import { START_UNLOCK } from './defaults';
import { formatCount } from './leveling';
import { SQUAD_SIZE } from './squad';
import type { CharacterDef, CharacterUnlock, ProgressData } from './types';

/**
 * 角色的获得方式（在「角色编辑」中设置）：
 *  - 开局拥有：一开始就可以用
 *  - 满足条件后自动获得：通关指定的关卡 / 无尽模式最高分达到（可以同时设置，全部满足才算）
 *  - 商店购买：满足条件（也可以不设条件）后，在商店里用游戏外货币购买
 * 获得的角色记录在进度的 owned 里，以后条件改了也不会失去。
 */

export function unlockOf(def: Pick<CharacterDef, 'unlock'>): CharacterUnlock {
  return def.unlock ?? START_UNLOCK;
}

/** 条件的文字：「通关 ZH_1」「无尽模式最高分达到 500」；没有条件 = 空字符串 */
export function conditionText(u: CharacterUnlock): string {
  const parts: string[] = [];
  if (u.level) parts.push(`通关 ${u.level}`);
  if (u.score > 0) parts.push(`无尽模式最高分达到 ${formatCount(u.score)}`);
  return parts.join('、');
}

/** 还没有达成的条件（显示用）；全部达成 = 空数组 */
export function missingConditions(u: CharacterUnlock, progress: ProgressData): string[] {
  const out: string[] = [];
  if (u.level && !progress.cleared.includes(u.level)) out.push(`通关 ${u.level}`);
  const best = progress.endlessBest?.score ?? 0;
  if (u.score > 0 && best < u.score) out.push(`无尽模式最高分达到 ${formatCount(u.score)}（现在 ${formatCount(Math.floor(best))}）`);
  return out;
}

export function conditionsMet(u: CharacterUnlock, progress: ProgressData): boolean {
  return missingConditions(u, progress).length === 0;
}

/** 获得方式的说明：「开局拥有」「通关 ZH_1 后自动获得」「商店购买 · 10,000 金币（通关 ZH_2 后可以购买）」 */
export function describeUnlock(u: CharacterUnlock, currencyName = '货币'): string {
  const cond = conditionText(u);
  if (u.mode === 'start') return '开局拥有';
  if (u.mode === 'auto') return cond ? `${cond} 后自动获得` : '自动获得（没有条件 = 开局就有）';
  const price = u.price > 0 ? `${formatCount(u.price)} ${currencyName}` : '免费';
  return `商店购买 · ${price}${cond ? `（${cond} 后可以购买）` : ''}`;
}

/** 玩家现在是否拥有这个角色 */
export function isOwned(def: CharacterDef, progress: ProgressData): boolean {
  const u = unlockOf(def);
  if (u.mode === 'start' || progress.owned.includes(def.id)) return true;
  return u.mode === 'auto' && conditionsMet(u, progress);
}

/** 已拥有的角色（按角色列表的顺序） */
export function ownedCharacters(list: CharacterDef[], progress: ProgressData): CharacterDef[] {
  return list.filter((c) => isOwned(c, progress));
}

/**
 * 新获得的角色加入编队：编队已经选过而且还有空位时（没有选过编队 = 默认前 12 个已拥有的角色，不用加）。
 * 编队里可能还记着没有获得的角色（不会出战）：空位按已拥有的角色计算，加入时去掉这些记录腾出位置。
 */
export function addToSquad(list: CharacterDef[], progress: ProgressData, ids: string[]): ProgressData {
  if (!progress.squad.length) return progress;
  const owned = new Set(ownedCharacters(list, progress).map((c) => c.id));
  const effective = progress.squad.filter((id) => owned.has(id));
  // 已经在编队里的（以前记着、现在获得了）保持原来的位置
  const add = ids.filter((id) => owned.has(id) && !effective.includes(id));
  const room = SQUAD_SIZE - effective.length;
  if (!add.length || room <= 0) return progress;
  return { ...progress, squad: [...effective, ...add.slice(0, room)] };
}

export type BuyResult = { ok: true; progress: ProgressData } | { ok: false; error: string };

/** 在商店购买：检查获得方式、条件和货币，返回新的进度（买到的角色有空位时自动加入编队；list = 全部角色） */
export function buyCharacter(def: CharacterDef, progress: ProgressData, list: CharacterDef[], currencyName = '货币'): BuyResult {
  const u = unlockOf(def);
  if (isOwned(def, progress)) return { ok: false, error: `已经拥有${def.name}` };
  if (u.mode !== 'shop') return { ok: false, error: `${def.name}不在商店出售` };
  const miss = missingConditions(u, progress);
  if (miss.length) return { ok: false, error: `需要先${miss.join('、')}` };
  if (progress.currency < u.price) return { ok: false, error: `${currencyName}不够：还差 ${formatCount(u.price - progress.currency)}` };
  const next = { ...progress, currency: progress.currency - u.price, owned: [...progress.owned, def.id] };
  return { ok: true, progress: addToSquad(list, next, [def.id]) };
}

/** 把满足条件、自动获得的角色记录下来（战斗结算后调用；以后条件改了也不会失去） */
export function recordAutoUnlocks(list: CharacterDef[], progress: ProgressData): ProgressData {
  const add = list.filter((c) => {
    const u = unlockOf(c);
    return u.mode === 'auto' && !progress.owned.includes(c.id) && conditionsMet(u, progress);
  });
  return add.length ? { ...progress, owned: [...progress.owned, ...add.map((c) => c.id)] } : progress;
}

/** before → after 之间新获得的角色（按角色列表的顺序） */
export function newlyOwned(list: CharacterDef[], before: ProgressData, after: ProgressData): CharacterDef[] {
  return list.filter((c) => !isOwned(c, before) && isOwned(c, after));
}

/** 战斗结算后：记录自动获得的角色，新获得的角色有空位时加入编队；返回新的进度和新获得的角色 */
export function claimUnlocks(list: CharacterDef[], before: ProgressData, after: ProgressData): { progress: ProgressData; gained: CharacterDef[] } {
  let progress = recordAutoUnlocks(list, after);
  const gained = newlyOwned(list, before, progress);
  if (gained.length) progress = addToSquad(list, progress, gained.map((c) => c.id));
  return { progress, gained };
}

/** 商店：可以购买的角色数量（首页显示） */
export function buyableCount(list: CharacterDef[], progress: ProgressData): number {
  return list.filter((c) => {
    const u = unlockOf(c);
    return u.mode === 'shop' && !isOwned(c, progress) && conditionsMet(u, progress) && progress.currency >= u.price;
  }).length;
}
