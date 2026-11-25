import { summonAsEnemy } from '../../core/defaults';
import { describeAttack, describeInherit, describeSummonTiming } from '../../core/describe';
import type { CharacterDef, EnemyDef, SkillDef, SummonDef } from '../../core/types';
import { UnitToken } from './tokens';

/** 角色可以召唤的召唤物（只算存在的角色的召唤物；敌人的召唤物不能被角色召唤） */
function allySummonsOf(def: CharacterDef, summons: Map<string, SummonDef>): SummonDef[] {
  return def.summons.map((id) => summons.get(id)).filter((s): s is SummonDef => !!s && s.side !== 'enemy');
}

/** 角色选择的召唤物：玩家的选择有效就用它，否则用第一个存在的召唤物 */
export function chosenSummonId(def: CharacterDef, summons: Map<string, SummonDef>, choice: Record<string, string>): string | null {
  const list = allySummonsOf(def, summons);
  const pick = choice[def.id];
  if (pick && list.some((s) => s.id === pick)) return pick;
  return list[0]?.id ?? null;
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
  const list = allySummonsOf(def, summons);
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

/** 敌人的召唤物列表（图鉴）：攻击方式为「召唤」的敌人会召唤列表里的全部召唤物 */
export function EnemySummonList({ def, summons, skills }: { def: EnemyDef; summons: Map<string, SummonDef>; skills: Map<string, SkillDef> }) {
  if (def.attackType !== 'summon') return null;
  const list = def.summons.map((id) => summons.get(id)).filter((s): s is SummonDef => !!s && s.side === 'enemy');
  return (
    <div className="summon-list">
      <h3 className="codex-sub">
        召唤物 <span className="muted small">（出现后按召唤间隔自动召唤，沿它剩下的路线前进）</span>
      </h3>
      {list.length === 0 && <div className="muted small">这个敌人还没有可以召唤的召唤物</div>}
      {list.map((s) => {
        const names = s.skills.slice(0, s.skillSlots).map((id) => skills.get(id)?.name ?? id);
        const healer = s.attackTarget === 'ally' && s.atk < 0;
        return (
          <div key={s.id} className="summon-card-row">
            <UnitToken kind="enemy" def={summonAsEnemy(s)} size={44} />
            <div className="summon-info">
              <div className="summon-name">
                <strong>{s.name}</strong> <span className="muted small mono">{s.id}</span>
                {s.invincible && <span className="badge badge-warn">无敌</span>}
                {s.keepAfterSummoner && <span className="badge">召唤者离场后保留</span>}
              </div>
              <div className="small">
                生命 {s.maxHp} · {healer ? `治疗 ${-s.atk}` : `攻击 ${s.atk}`} · 物抗 {s.def} · 法抗 {s.res}% · 速度 {s.speed} 格/秒
                {s.attackType !== 'none' ? ` · ${s.range > 0 ? `范围 ${s.range}` : '只攻击阻挡者'}` : ''}
                {s.reward ? ` · 奖励 ${s.reward}` : ''}
              </div>
              <div className="small">{describeSummonTiming(s)}</div>
              <div className="muted small">
                {describeAttack(s)} · {describeInherit(s.inherit)}
                {names.length ? ` · 技能：${names.join('、')}` : ''}
              </div>
              {s.description && <div className="muted small">{s.description}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
