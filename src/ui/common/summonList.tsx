import { describeAttack, describeInherit } from '../../core/describe';
import type { CharacterDef, SkillDef, SummonDef } from '../../core/types';
import { UnitToken } from './tokens';

/** 角色选择的召唤物：玩家的选择有效就用它，否则用第一个存在的召唤物 */
export function chosenSummonId(def: CharacterDef, summons: Map<string, SummonDef>, choice: Record<string, string>): string | null {
  const pick = choice[def.id];
  if (pick && def.summons.includes(pick) && summons.has(pick)) return pick;
  return def.summons.find((id) => summons.has(id)) ?? null;
}

/**
 * 召唤者的召唤物列表（角色设定、图鉴共用）：固定只能选 1 个。
 * onChoose 为空时只显示，不能选择。
 */
export function SummonList({
  def,
  summons,
  skills,
  choice,
  onChoose,
}: {
  def: CharacterDef;
  summons: Map<string, SummonDef>;
  skills: Map<string, SkillDef>;
  choice: Record<string, string>;
  onChoose?: (summonId: string) => void;
}) {
  const list = def.summons.map((id) => summons.get(id)).filter((s): s is SummonDef => !!s);
  const chosen = chosenSummonId(def, summons, choice);
  if (def.attackType !== 'summon') return null;
  return (
    <div className="summon-list">
      <h3 className="codex-sub">
        召唤物 <span className="muted small">（部署后出现在部署栏，{list.length > 1 ? '只能选择 1 个' : '固定 1 个'}）</span>
      </h3>
      {list.length === 0 && <div className="muted small">这个角色还没有可以召唤的召唤物</div>}
      {list.map((s) => {
        const on = s.id === chosen;
        const names = s.skills.slice(0, s.skillSlots).map((id) => skills.get(id)?.name ?? id);
        const body = (
          <>
            <UnitToken kind="summon" def={s} size={44} />
            <div className="summon-info">
              <div className="summon-name">
                <strong>{s.name}</strong> <span className="muted small mono">{s.id}</span>
                {on && <span className="badge">{list.length > 1 ? '已选择' : '召唤物'}</span>}
                {s.invincible && <span className="badge badge-warn">无敌</span>}
              </div>
              <div className="small">
                费用 {s.cost} · 生命 {s.maxHp} · {s.attackTarget === 'ally' && s.atk < 0 ? `治疗 ${-s.atk}` : `攻击 ${s.atk}`} · 物抗 {s.def} · 法抗 {s.res}% · 范围 {s.range}
                {s.maxDeploy > 0 ? ` · 最多 ${s.maxDeploy} 个` : ''}
              </div>
              <div className="muted small">
                {describeAttack(s)} · {describeInherit(s.inherit)}
                {s.nearSummoner ? ' · 只能放在召唤者的攻击范围内' : ''}
                {names.length ? ` · 技能：${names.join('、')}` : ''}
              </div>
              {s.description && <div className="muted small">{s.description}</div>}
            </div>
          </>
        );
        return onChoose && list.length > 1 ? (
          <button key={s.id} type="button" className={`summon-card-row selectable${on ? ' selected' : ''}`} onClick={() => onChoose(s.id)}>
            {body}
          </button>
        ) : (
          <div key={s.id} className={`summon-card-row${on ? ' selected' : ''}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
