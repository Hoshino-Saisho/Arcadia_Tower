import { useEffect, useState } from 'react';
import { resolveLoadout } from '../../core/defaults';
import { describeAttack } from '../../core/describe';
import { loadDatabase, loadProgress, saveProgress, type GameDatabase } from '../../core/storage/repository';
import type { SkillDef } from '../../core/types';
import { SkillCard } from '../common/skillCard';
import { toast } from '../common/toast';
import { UnitToken } from '../common/tokens';
import { navigate } from '../router';

/**
 * 角色设定：选择每个角色在战斗中携带的技能。
 * 例如角色只能携带 1 个技能但拥有 3 个技能时，在 3 个技能中选择 1 个。
 */
export function CharactersPage() {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [loadouts, setLoadouts] = useState<Record<string, string[]>>({});
  useEffect(() => {
    void loadDatabase().then((d) => {
      setDb(d);
      setLoadouts(d.progress.loadouts);
    });
  }, []);
  if (!db) return <div className="page-msg">加载中…</div>;

  const def = db.characters.find((c) => c.id === sel) ?? db.characters[0];
  const skillMap = new Map(db.skills.map((s) => [s.id, s]));

  const persist = async (next: Record<string, string[]>) => {
    setLoadouts(next);
    try {
      const p = await loadProgress();
      await saveProgress({ ...p, loadouts: next });
    } catch (err) {
      toast(`保存失败：${String(err)}`, 'error');
    }
  };

  const toggle = (skillId: string) => {
    if (!def) return;
    const cur = resolveLoadout(def, loadouts[def.id]);
    let next: string[];
    if (cur.includes(skillId)) {
      if (cur.length <= 1) return toast('至少携带 1 个技能；点击其他技能即可替换', 'info', 1800);
      next = cur.filter((id) => id !== skillId);
    } else if (cur.length < def.skillSlots) {
      next = [...cur, skillId];
    } else if (def.skillSlots === 1) {
      next = [skillId];
    } else {
      return toast(`最多携带 ${def.skillSlots} 个技能，请先取消一个`, 'error', 1800);
    }
    // 按角色技能列表的顺序保存
    next = def.skills.filter((id) => next.includes(id));
    void persist({ ...loadouts, [def.id]: next });
  };

  return (
    <div className="select-page codex">
      <header className="select-head">
        <button className="btn btn-ghost" onClick={() => navigate('/game')}>
          ← 返回
        </button>
        <h2>角色设定</h2>
        <span className="muted small">选择角色在战斗中携带的技能</span>
      </header>
      <div className="codex-body">
        <div className="codex-grid">
          {db.characters.map((c) => {
            const eq = resolveLoadout(c, loadouts[c.id]);
            return (
              <button key={c.id} className={`codex-entry${def?.id === c.id ? ' active' : ''}`} onClick={() => setSel(c.id)}>
                <UnitToken kind="character" def={c} size={48} />
                <span className="codex-entry-name">{c.name}</span>
                <span className="muted small">
                  技能 {eq.length}/{c.skillSlots}
                </span>
              </button>
            );
          })}
        </div>
        {def && (
          <section className="codex-detail">
            <div className="codex-head">
              <UnitToken kind="character" def={def} size={72} />
              <div>
                <div className="codex-name">{def.name}</div>
                <div className="muted">{describeAttack(def)}</div>
                <div className="loadout-slots">
                  战斗中可携带 <strong>{def.skillSlots}</strong> 个技能，共有 <strong>{def.skills.length}</strong> 个技能可选
                </div>
              </div>
            </div>
            {def.skills.length === 0 && <div className="muted">这个角色没有技能</div>}
            {def.skillSlots === 0 && def.skills.length > 0 && <div className="muted">这个角色不能携带技能</div>}
            <div className="skill-list">
              {def.skills
                .map((id) => skillMap.get(id))
                .filter((s): s is SkillDef => !!s)
                .map((s) => {
                  const equipped = resolveLoadout(def, loadouts[def.id]).includes(s.id);
                  return (
                    <SkillCard
                      key={s.id}
                      skill={s}
                      selected={equipped}
                      badge={equipped ? '已携带' : undefined}
                      disabled={def.skillSlots === 0}
                      onClick={() => toggle(s.id)}
                    />
                  );
                })}
            </div>
            {loadouts[def.id] && (
              <button
                className="btn btn-s btn-ghost"
                onClick={() => {
                  const next = { ...loadouts };
                  delete next[def.id];
                  void persist(next);
                }}
              >
                恢复默认（携带前 {def.skillSlots} 个技能）
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
