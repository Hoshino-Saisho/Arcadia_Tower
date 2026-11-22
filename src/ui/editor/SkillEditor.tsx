import { useEffect, useState } from 'react';
import { newEffect, newSkill } from '../../core/defaults';
import { describeEffect } from '../../core/describe';
import { nextId, validateUnitId } from '../../core/ids';
import { loadCharacters, loadEnemies, loadSkills, saveSkills } from '../../core/storage/repository';
import type { CharacterDef, EnemyDef, SkillDef, SkillEffect } from '../../core/types';
import { ColorInput, Field, NumberInput, Segmented, TextInput } from '../common/fields';
import { SkillCard } from '../common/skillCard';
import { UnitToken } from '../common/tokens';
import { DefListPanel, SaveBar } from './DefListPanel';
import type { EditorTabProps } from './EditorApp';
import { ModifierListEditor } from './effectEditors';
import { notifySaved } from '../../core/github/sync';
import { useListDraft, useSaveShortcut } from './useListDraft';

/**
 * 技能编辑：
 *  - 每个技能积攒 SP，满了才能释放；SP 上限、积累方式（攻击成功 / 自动）和速度单独设置
 *  - 释放方式：SP 满自动释放，或在战斗中点击角色后手动释放
 *  - 效果可以有任意多个：增益 / 减益（任意属性、任意数值，可同时有增益和减益）、伤害 / 治疗
 */
export function SkillEditor({ onDirtyChange }: EditorTabProps) {
  const draft = useListDraft<SkillDef>({
    load: loadSkills,
    save: async (list, renames) => {
      await saveSkills(list, renames);
      notifySaved('技能');
    },
    validateId: validateUnitId,
    onDirtyChange,
    label: '技能',
  });
  const [users, setUsers] = useState<{ chars: CharacterDef[]; enemies: EnemyDef[] }>({ chars: [], enemies: [] });
  useEffect(() => {
    void Promise.all([loadCharacters(), loadEnemies()]).then(([chars, enemies]) => setUsers({ chars, enemies }));
  }, []);
  useSaveShortcut(() => void draft.saveAll());

  if (draft.loadError) return <div className="page-msg">读取技能失败：{draft.loadError}</div>;
  if (!draft.items) return <div className="page-msg">加载中…</div>;
  const sel = draft.selected;
  const sk = sel?.value;
  const set = (patch: Partial<SkillDef>) => sel && draft.update(sel.key, patch);
  const ids = draft.items.map((d) => d.value.id);
  const setEffect = (i: number, patch: Partial<SkillEffect>) => sk && set({ effects: sk.effects.map((e, k) => (k === i ? { ...e, ...patch } : e)) });
  const lookupId = sel?.origId ?? sk?.id ?? '';

  return (
    <div className="def-editor">
      <DefListPanel
        title="技能"
        items={draft.items}
        selectedKey={draft.selectedKey}
        errors={draft.errors}
        onSelect={draft.setSelectedKey}
        onAdd={() => draft.add(newSkill(nextId('S', ids)), draft.selectedKey)}
        onDuplicate={() => sk && draft.add({ ...structuredClone(sk), id: nextId('S', ids), name: `${sk.name} 副本` }, draft.selectedKey)}
        onDelete={() => sel && window.confirm(`删除技能「${sk!.name}」（${sk!.id}）？\n引用它的角色 / 敌人会自动忽略这个技能。`) && draft.remove(sel.key)}
        onMove={(d) => sel && draft.move(sel.key, draft.items!.indexOf(sel) + d)}
        renderIcon={(v) => <span className="skill-dot big" style={{ background: v.color }} />}
        renderMeta={(v) => <span className="muted small">{v.trigger === 'manual' ? '手动' : '自动'}</span>}
      />

      {sk && sel ? (
        <section className="def-form">
          <div className="form-scroll">
            <h3 className="form-title">基本信息</h3>
            <div className="form-grid">
              <Field label="ID" hint="唯一编号，角色 / 敌人通过 ID 引用技能">
                <TextInput value={sk.id} invalid={draft.errors.has(sel.key)} maxLength={24} onChange={(v) => set({ id: v.trim() })} />
                {draft.errors.has(sel.key) && <span className="field-error">{draft.errors.get(sel.key)}</span>}
              </Field>
              <Field label="名称">
                <TextInput value={sk.name} maxLength={20} onChange={(v) => set({ name: v })} />
              </Field>
              <Field label="颜色" hint="技能按钮、SP 条、释放特效的颜色" wide>
                <ColorInput value={sk.color} onChange={(v) => set({ color: v })} />
              </Field>
              <Field label="补充说明（可选）" hint="效果说明会根据数值自动生成，这里写额外的介绍" wide>
                <textarea className="input" rows={2} value={sk.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} />
              </Field>
            </div>

            <h3 className="form-title">SP 与释放</h3>
            <div className="form-grid cols-4">
              <Field label="SP 上限" hint="积满才能释放">
                <NumberInput value={sk.spMax} min={0} max={9999} onChange={(v) => set({ spMax: v })} />
              </Field>
              <Field label="初始 SP" hint="部署 / 出现时">
                <NumberInput value={sk.spInitial} min={0} max={9999} onChange={(v) => set({ spInitial: v })} />
              </Field>
              <Field label="积累方式" wide>
                <Segmented
                  value={sk.spGain}
                  options={[
                    { value: 'attack', label: '攻击成功', title: '每次攻击（无论攻击敌人还是队友）获得 SP' },
                    { value: 'auto', label: '自动积累', title: '每秒自动获得 SP' },
                  ]}
                  onChange={(v) => set({ spGain: v })}
                />
              </Field>
              <Field label={sk.spGain === 'attack' ? '每次攻击获得 SP' : '每秒获得 SP'}>
                <NumberInput value={sk.spRate} min={0} max={9999} step={0.5} onChange={(v) => set({ spRate: v })} />
              </Field>
              <Field label="持续时间" hint="秒，0 = 瞬间">
                <NumberInput value={sk.duration} min={0} max={3600} step={0.5} onChange={(v) => set({ duration: v })} />
              </Field>
              <Field label="释放方式" wide>
                <Segmented
                  value={sk.trigger}
                  options={[
                    { value: 'auto', label: 'SP 满自动释放' },
                    { value: 'manual', label: '手动释放', title: '战斗中点击角色后选择技能释放（敌人总是自动释放）' },
                  ]}
                  onChange={(v) => set({ trigger: v })}
                />
              </Field>
            </div>

            <h3 className="form-title">
              技能效果 <span className="muted small">（可以添加任意数量）</span>
            </h3>
            <div className="effect-list">
              {sk.effects.map((e, i) => (
                <div key={i} className={`effect-card ${e.kind}`}>
                  <div className="effect-head">
                    <strong>效果 {i + 1}</strong>
                    <Segmented
                      value={e.kind}
                      options={[
                        { value: 'modify', label: '增益 / 减益' },
                        { value: 'damage', label: '伤害 / 治疗' },
                      ]}
                      onChange={(kind) => setEffect(i, kind === e.kind ? {} : { ...newEffect(kind), target: e.target, scope: e.scope, radius: e.radius, maxTargets: e.maxTargets })}
                    />
                    <span className="grow" />
                    <button className="icon-btn" disabled={i === 0} onClick={() => set({ effects: swapArr(sk.effects, i, i - 1) })} title="上移">
                      ↑
                    </button>
                    <button className="icon-btn" disabled={i === sk.effects.length - 1} onClick={() => set({ effects: swapArr(sk.effects, i, i + 1) })} title="下移">
                      ↓
                    </button>
                    <button className="icon-btn danger" onClick={() => set({ effects: sk.effects.filter((_, k) => k !== i) })} title="删除效果">
                      ×
                    </button>
                  </div>
                  <div className="form-grid cols-4">
                    <Field label="作用对象" wide>
                      <Segmented
                        value={e.target}
                        options={[
                          { value: 'self', label: '自身' },
                          { value: 'allies', label: '友方' },
                          { value: 'enemies', label: '敌方' },
                        ]}
                        onChange={(target) => setEffect(i, { target })}
                      />
                    </Field>
                    {e.target !== 'self' && (
                      <>
                        <Field label="范围">
                          <Segmented
                            value={e.scope}
                            options={[
                              { value: 'range', label: '半径内' },
                              { value: 'all', label: '全场' },
                            ]}
                            onChange={(scope) => setEffect(i, { scope })}
                          />
                        </Field>
                        <Field label="半径" hint="格，0 = 攻击范围">
                          <NumberInput value={e.radius} min={0} max={50} step={0.5} disabled={e.scope === 'all'} onChange={(radius) => setEffect(i, { radius })} />
                        </Field>
                        <Field label="最多目标" hint="-1 = 不限">
                          <NumberInput value={e.maxTargets} min={-1} max={99} integer onChange={(v) => setEffect(i, { maxTargets: v === 0 ? -1 : v })} />
                        </Field>
                      </>
                    )}
                  </div>
                  {e.kind === 'modify' ? (
                    <>
                      <div className="form-grid cols-4">
                        <Field label="持续时间" hint="秒，0 = 跟随技能">
                          <NumberInput value={e.duration} min={0} max={3600} step={0.5} onChange={(duration) => setEffect(i, { duration })} />
                        </Field>
                      </div>
                      <div className="field-label effect-sub">属性修改（正数 / 负数可以混合，例如同时降低物抗和法抗）</div>
                      <ModifierListEditor value={e.modifiers} onChange={(modifiers) => setEffect(i, { modifiers })} />
                    </>
                  ) : (
                    <div className="form-grid cols-4">
                      <Field label="数值" hint="攻击力的 %，负数 = 治疗">
                        <NumberInput value={e.amount} min={-100000} max={100000} step={10} onChange={(amount) => setEffect(i, { amount })} />
                      </Field>
                      <Field label="伤害类型" wide>
                        <Segmented
                          value={e.damageType}
                          options={[
                            { value: 'physical', label: '物伤' },
                            { value: 'magic', label: '法伤' },
                            { value: 'true', label: '真实伤害' },
                          ]}
                          onChange={(damageType) => setEffect(i, { damageType })}
                        />
                      </Field>
                    </div>
                  )}
                  <div className="effect-preview">{describeEffect(e, sk.duration)}</div>
                </div>
              ))}
              <div className="row gap-s">
                <button className="btn btn-s" onClick={() => set({ effects: [...sk.effects, newEffect('modify')] })}>
                  + 增益 / 减益效果
                </button>
                <button className="btn btn-s" onClick={() => set({ effects: [...sk.effects, newEffect('damage')] })}>
                  + 伤害 / 治疗效果
                </button>
              </div>
            </div>
          </div>
          <SaveBar dirty={draft.dirty} saving={draft.saving} onSave={() => void draft.saveAll()} />
        </section>
      ) : (
        <section className="def-form empty-hint">选择或新建一个技能</section>
      )}

      {sk && (
        <aside className="def-preview">
          <div className="panel-head">预览（图鉴中的显示）</div>
          <SkillCard skill={sk} />
          <div className="panel-head">使用这个技能的单位</div>
          <div className="usage-list">
            {users.chars
              .filter((c) => c.skills.includes(lookupId))
              .map((c) => (
                <div key={c.id} className="usage-item">
                  <UnitToken kind="character" def={c} size={24} />
                  {c.name} <span className="muted small mono">{c.id}</span>
                </div>
              ))}
            {users.enemies
              .filter((e) => e.skills.includes(lookupId))
              .map((e) => (
                <div key={e.id} className="usage-item">
                  <UnitToken kind="enemy" def={e} size={24} />
                  {e.name} <span className="muted small mono">{e.id}</span>
                </div>
              ))}
            {!users.chars.some((c) => c.skills.includes(lookupId)) && !users.enemies.some((e) => e.skills.includes(lookupId)) && (
              <div className="muted small">还没有角色或敌人使用（在角色 / 敌人编辑中添加）</div>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

function swapArr<T>(arr: T[], a: number, b: number): T[] {
  const out = arr.slice();
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}
