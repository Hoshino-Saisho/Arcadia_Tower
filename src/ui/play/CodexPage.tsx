import { useEffect, useState, type ReactNode } from 'react';
import { describeAttack, describeOnHit } from '../../core/describe';
import { DAMAGE_TYPE_LABEL } from '../../core/stats';
import { loadDatabase, type GameDatabase } from '../../core/storage/repository';
import type { CharacterDef, EnemyDef, SkillDef } from '../../core/types';
import { RangeGrid } from '../common/rangeGrid';
import { SkillCard } from '../common/skillCard';
import { UnitToken } from '../common/tokens';
import { navigate } from '../router';

const PLACEMENT = { ground: '地面', high: '高台', any: '地面 / 高台' } as const;

/** 图鉴：每个角色和敌人的数值与技能 */
export function CodexPage() {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [tab, setTab] = useState<'characters' | 'enemies'>('characters');
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => {
    void loadDatabase().then(setDb);
  }, []);
  if (!db) return <div className="page-msg">加载中…</div>;

  const list: (CharacterDef | EnemyDef)[] = tab === 'characters' ? db.characters : db.enemies;
  const current = list.find((d) => d.id === sel) ?? list[0];
  const skillMap = new Map(db.skills.map((s) => [s.id, s]));

  return (
    <div className="select-page codex">
      <header className="select-head">
        <button className="btn btn-ghost" onClick={() => navigate('/game')}>
          ← 返回
        </button>
        <h2>图鉴</h2>
        <div className="segmented">
          <button className={tab === 'characters' ? 'active' : ''} onClick={() => (setTab('characters'), setSel(null))}>
            角色 {db.characters.length}
          </button>
          <button className={tab === 'enemies' ? 'active' : ''} onClick={() => (setTab('enemies'), setSel(null))}>
            敌人 {db.enemies.length}
          </button>
        </div>
      </header>
      <div className="codex-body">
        <div className="codex-grid">
          {list.map((d) => (
            <button key={d.id} className={`codex-entry${current?.id === d.id ? ' active' : ''}`} onClick={() => setSel(d.id)}>
              <UnitToken kind={tab === 'characters' ? 'character' : 'enemy'} def={d} size={48} />
              <span className="codex-entry-name">{d.name}</span>
              <span className="muted small mono">{d.id}</span>
            </button>
          ))}
          {list.length === 0 && <div className="empty-hint">暂无数据</div>}
        </div>
        {current && (
          <section className="codex-detail">
            {tab === 'characters' ? (
              <CharacterDetail def={current as CharacterDef} skills={skillMap} />
            ) : (
              <EnemyDetail def={current as EnemyDef} skills={skillMap} />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function SkillList({ ids, slots, skills }: { ids: string[]; slots: number; skills: Map<string, SkillDef> }) {
  const list = ids.map((id) => skills.get(id)).filter((s): s is SkillDef => !!s);
  return (
    <>
      <h3 className="codex-sub">
        技能 <span className="muted small">（战斗中可携带 {slots} 个）</span>
      </h3>
      {list.length === 0 && <div className="muted small">没有技能</div>}
      <div className="skill-list">
        {list.map((s) => (
          <SkillCard key={s.id} skill={s} />
        ))}
      </div>
    </>
  );
}

function Head({ kind, def }: { kind: 'character' | 'enemy'; def: CharacterDef | EnemyDef }) {
  return (
    <div className="codex-head">
      <UnitToken kind={kind} def={def} size={84} />
      <div>
        <div className="codex-name">{def.name}</div>
        <div className="muted mono">{def.id}</div>
        {def.description && <div className="codex-desc">{def.description}</div>}
      </div>
    </div>
  );
}

function CharacterDetail({ def, skills }: { def: CharacterDef; skills: Map<string, SkillDef> }) {
  const healer = def.attackTarget === 'ally' && def.atk < 0;
  return (
    <>
      <Head kind="character" def={def} />
      <dl className="stat-grid codex-stats">
        <Row k="费用" v={def.cost} />
        <Row k="部署位置" v={PLACEMENT[def.placement]} />
        <Row k="生命值" v={def.maxHp} />
        <Row k={healer ? '治疗量' : '攻击力'} v={healer ? -def.atk : def.atk} />
        <Row k="物抗" v={def.def} />
        <Row k="法抗" v={`${def.res}%`} />
        <Row k="攻击方式" v={describeAttack(def)} />
        <Row k="伤害类型" v={healer ? '—' : DAMAGE_TYPE_LABEL[def.damageType]} />
        <Row k="攻击间隔" v={`${def.attackInterval} 秒`} />
        <Row k="攻击范围" v={`${def.range} 格`} />
        <Row k="阻挡数" v={def.placement === 'high' ? '—' : def.blockCount} />
        <Row k="同时部署" v={def.maxDeploy > 0 ? `最多 ${def.maxDeploy} 个` : '不限'} />
      </dl>
      <div className="codex-range">
        <RangeGrid range={def.range} color={healer ? '#5dff9d' : def.color} cell={16} />
        <span className="muted small">射程（中间 = 角色所在方块）</span>
      </div>
      {describeOnHit(def.onHit) && <div className="codex-note">{describeOnHit(def.onHit)}</div>}
      <SkillList ids={def.skills} slots={def.skillSlots} skills={skills} />
    </>
  );
}

function EnemyDetail({ def, skills }: { def: EnemyDef; skills: Map<string, SkillDef> }) {
  const healer = def.attackTarget === 'ally' && def.atk < 0;
  return (
    <>
      <Head kind="enemy" def={def} />
      <dl className="stat-grid codex-stats">
        <Row k="生命值" v={def.maxHp} />
        <Row k={healer ? '治疗量' : '攻击力'} v={healer ? -def.atk : def.atk} />
        <Row k="物抗" v={def.def} />
        <Row k="法抗" v={`${def.res}%`} />
        <Row k="移动速度" v={`${def.speed} 格/秒`} />
        <Row k="攻击方式" v={describeAttack(def)} />
        <Row k="攻击间隔" v={def.canAttack ? `${def.attackInterval} 秒` : '—'} />
        <Row k="攻击范围" v={def.canAttack ? (def.attackRange > 0 ? `${def.attackRange} 格` : '只攻击阻挡者') : '—'} />
        <Row k="击杀奖励" v={def.reward} />
        <Row k="外形" v={`${def.sides} 边形`} />
      </dl>
      {def.canAttack && def.attackRange > 0 && (
        <div className="codex-range">
          <RangeGrid range={def.attackRange} color={healer ? '#5dff9d' : def.color} cell={16} />
          <span className="muted small">射程（中间 = 敌人所在方块）</span>
        </div>
      )}
      {describeOnHit(def.onHit) && <div className="codex-note">{describeOnHit(def.onHit)}</div>}
      <SkillList ids={def.skills} slots={def.skillSlots} skills={skills} />
    </>
  );
}
