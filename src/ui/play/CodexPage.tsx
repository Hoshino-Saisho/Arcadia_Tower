import { useEffect, useState, type ReactNode } from 'react';
import { describeAttack, describeOnHit } from '../../core/describe';
import { DAMAGE_TYPE_LABEL } from '../../core/stats';
import { loadDatabase, loadProgress, saveProgress, type GameDatabase } from '../../core/storage/repository';
import type { CharacterDef, EnemyDef, SkillDef, SummonDef } from '../../core/types';
import { RangeGrid } from '../common/rangeGrid';
import { SkillCard } from '../common/skillCard';
import { EnemySummonList, SummonList } from '../common/summonList';
import { toast } from '../common/toast';
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
  const summonMap = new Map(db.summons.map((s) => [s.id, s]));
  /** 在图鉴中也可以选择召唤物（和角色设定中的选择是同一个） */
  const chooseSummon = async (charId: string, summonId: string) => {
    try {
      const p = await loadProgress();
      const next = { ...p, summonChoice: { ...p.summonChoice, [charId]: summonId } };
      await saveProgress(next);
      setDb({ ...db, progress: next });
    } catch (err) {
      toast(`保存失败：${String(err)}`, 'error');
    }
  };

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
              <CharacterDetail
                def={current as CharacterDef}
                skills={skillMap}
                summons={summonMap}
                choice={db.progress.summonChoice}
                onChoose={(id) => void chooseSummon(current.id, id)}
              />
            ) : (
              <EnemyDetail def={current as EnemyDef} skills={skillMap} summons={summonMap} />
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

function SkillList({ ids, slots, skills, side = 'ally' }: { ids: string[]; slots: number; skills: Map<string, SkillDef>; side?: 'ally' | 'enemy' }) {
  const list = ids.map((id) => skills.get(id)).filter((s): s is SkillDef => !!s);
  return (
    <>
      <h3 className="codex-sub">
        技能 <span className="muted small">（战斗中可携带 {slots} 个）</span>
      </h3>
      {list.length === 0 && <div className="muted small">没有技能</div>}
      <div className="skill-list">
        {list.map((s) => (
          <SkillCard key={s.id} skill={s} side={side} />
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

function CharacterDetail({
  def,
  skills,
  summons,
  choice,
  onChoose,
}: {
  def: CharacterDef;
  skills: Map<string, SkillDef>;
  summons: Map<string, SummonDef>;
  choice: Record<string, string>;
  onChoose: (summonId: string) => void;
}) {
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
        <Row k="部署冷却" v={def.deployCooldown > 0 ? `${def.deployCooldown} 秒` : '无'} />
        <Row
          k="升级成长"
          v={`每级 生命 +${def.growth.maxHp} · ${healer ? '治疗' : '攻击'} +${def.growth.atk} · 物抗 +${def.growth.def}${def.growth.res ? ` · 法抗 +${def.growth.res}%` : ''}`}
        />
      </dl>
      <div className="muted small">以上是 1 级的数值；在「角色设定」中用经验书升级。</div>
      <div className="codex-range">
        <RangeGrid range={def.range} color={healer ? '#5dff9d' : def.color} cell={16} />
        <span className="muted small">射程（中间 = 角色所在方块）</span>
      </div>
      {describeOnHit(def.onHit) && <div className="codex-note">{describeOnHit(def.onHit)}</div>}
      <SkillList ids={def.skills} slots={def.skillSlots} skills={skills} />
      <SummonList def={def} summons={summons} skills={skills} choice={choice} onChoose={onChoose} />
    </>
  );
}

function EnemyDetail({ def, skills, summons }: { def: EnemyDef; skills: Map<string, SkillDef>; summons: Map<string, SummonDef> }) {
  const healer = def.attackTarget === 'ally' && def.atk < 0;
  // 召唤者「自身不攻击」时没有攻击间隔 / 范围
  const attacks = def.canAttack && !(def.attackType === 'summon' && def.summonAttack === 'none');
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
        <Row k="攻击间隔" v={attacks ? `${def.attackInterval} 秒` : '—'} />
        <Row k="攻击范围" v={attacks ? (def.attackRange > 0 ? `${def.attackRange} 格` : '只攻击阻挡者') : '—'} />
        <Row k="击杀奖励" v={def.reward} />
        <Row k="外形" v={`${def.sides} 边形`} />
        <Row k="无尽模式" v={`分数 ${def.endlessScore} · 难度 ${def.endlessDifficulty} · 出现位列 ${def.endlessRank}`} />
      </dl>
      {attacks && def.attackRange > 0 && (
        <div className="codex-range">
          <RangeGrid range={def.attackRange} color={healer ? '#5dff9d' : def.color} cell={16} />
          <span className="muted small">射程（中间 = 敌人所在方块）</span>
        </div>
      )}
      {describeOnHit(def.onHit) && <div className="codex-note">{describeOnHit(def.onHit)}</div>}
      <SkillList ids={def.skills} slots={def.skillSlots} skills={skills} side="enemy" />
      <EnemySummonList def={def} summons={summons} skills={skills} />
    </>
  );
}
