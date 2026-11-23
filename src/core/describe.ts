import { DAMAGE_TYPE_LABEL, formatModifier, formatNumber } from './stats';
import type { AttackTarget, DamageType, OnHitEffect, SkillDef, SkillEffect } from './types';

/**
 * 根据数据自动生成说明文字（图鉴、编辑器预览、战斗面板共用），
 * 这样数值修改后说明永远是最新的。
 */

export function describeSkillTrigger(s: SkillDef): string {
  const gain = s.spGain === 'attack' ? `每次攻击 +${formatNumber(s.spRate)} SP` : `每秒 +${formatNumber(s.spRate)} SP`;
  const init = s.spInitial > 0 ? `，初始 ${formatNumber(s.spInitial)}` : '';
  const trig = s.trigger === 'auto' ? 'SP 满后自动释放' : 'SP 满后手动释放';
  const dur = s.duration > 0 ? `持续 ${formatNumber(s.duration)} 秒` : '瞬间生效';
  return `SP ${formatNumber(s.spMax)}（${gain}${init}）· ${trig} · ${dur}`;
}

function targetText(e: SkillEffect): string {
  const who = e.target === 'self' ? '自身' : e.target === 'allies' ? '友方' : '敌方';
  if (e.target === 'self') return who;
  const where = e.scope === 'all' ? '全场' : e.radius > 0 ? `${formatNumber(e.radius)} 格内` : '攻击范围内';
  const limit = e.maxTargets > 0 ? `（最多 ${e.maxTargets} 个）` : '';
  return `${where}${who}${limit}`;
}

/** 金钱效果的说明；敌人释放时玩家失去金钱 */
function describeMoney(e: SkillEffect, skillDuration: number, side: 'ally' | 'enemy'): string {
  const sign = side === 'enemy' ? -1 : 1;
  const who = side === 'enemy' ? '玩家' : '';
  // 角色：获得 / 消耗；敌人：玩家获得 / 玩家失去
  const verb = (v: number) => (v * sign >= 0 ? '获得' : side === 'enemy' ? '失去' : '消耗');
  const parts: string[] = [];
  if (e.money) parts.push(`${who}立即${verb(e.money)} ${formatNumber(Math.abs(e.money))} 金钱`);
  if (e.moneyRate) {
    const dur = e.duration > 0 ? e.duration : skillDuration;
    parts.push(
      dur > 0
        ? `${who}每秒${verb(e.moneyRate)} ${formatNumber(Math.abs(e.moneyRate))} 金钱，持续 ${formatNumber(dur)} 秒（共 ${formatNumber(Math.abs(e.moneyRate) * dur)}）`
        : `每秒金钱（无持续时间，不生效）`,
    );
  }
  return parts.length ? `金钱：${parts.join('，')}` : '金钱：（未设置）';
}

/** side：释放者是角色还是敌人（敌人的金钱效果 = 玩家失去金钱） */
export function describeEffect(e: SkillEffect, skillDuration: number, side: 'ally' | 'enemy' = 'ally'): string {
  if (e.kind === 'money') return describeMoney(e, skillDuration, side);
  const t = targetText(e);
  if (e.kind === 'damage') {
    if (e.amount < 0) return `治疗${t}，治疗量为攻击力的 ${formatNumber(-e.amount)}%`;
    return `对${t}造成攻击力 ${formatNumber(e.amount)}% 的${DAMAGE_TYPE_LABEL[e.damageType]}`;
  }
  if (!e.modifiers.length) return `${t}：（未设置属性）`;
  const dur = e.duration > 0 ? e.duration : skillDuration;
  const durText = dur > 0 ? `，持续 ${formatNumber(dur)} 秒` : '（无持续时间，不生效）';
  return `${t}：${e.modifiers.map(formatModifier).join('，')}${durText}`;
}

export function describeSkill(s: SkillDef, side: 'ally' | 'enemy' = 'ally'): string[] {
  return s.effects.length ? s.effects.map((e) => describeEffect(e, s.duration, side)) : ['（没有效果）'];
}

export function describeAttack(opts: {
  atk: number;
  damageType: DamageType;
  attackTarget: AttackTarget;
  targetCount: number;
  attackType?: string;
  canAttack?: boolean;
}): string {
  if (opts.canAttack === false) return '不攻击';
  const area = opts.attackType === 'area';
  const count = area ? '范围（射程内全部）' : opts.targetCount < 0 ? '子弹 · 射程内全部目标' : opts.targetCount === 1 ? '子弹 · 单个目标' : `子弹 · ${opts.targetCount} 个目标`;
  if (opts.attackTarget === 'ally') {
    return opts.atk < 0 ? `治疗队友 · ${count}` : `攻击队友（${DAMAGE_TYPE_LABEL[opts.damageType]}）· ${count}`;
  }
  return `${DAMAGE_TYPE_LABEL[opts.damageType]} · ${count}`;
}

export function describeOnHit(h: OnHitEffect | null): string | null {
  if (!h || !h.modifiers.length) return null;
  return `命中附带：${h.modifiers.map(formatModifier).join('，')}，持续 ${formatNumber(h.duration)} 秒`;
}
