import { useEffect, useRef, useState } from 'react';
import { RES_MIN, newEndlessConfig, newEnemy } from '../../core/defaults';
import { firstWaveOf, groupSize } from '../../core/endless';
import { describeAttack, describeOnHit } from '../../core/describe';
import { notifySaved } from '../../core/github/sync';
import { nextId, validateUnitId } from '../../core/ids';
import { loadEndless, loadEnemies, loadSkills, saveEnemies } from '../../core/storage/repository';
import { tileInfo } from '../../core/tiles';
import type { EndlessConfig, EnemyDef, EnemySides, SkillDef } from '../../core/types';
import { enemyRadius } from '../../game/entities';
import { useIcon } from '../../game/icons';
import { drawRangeTiles } from '../../game/renderer';
import { drawEnemyToken, drawTile } from '../../game/shapes';
import { listAttackTypes } from '../../game/attacks';
import { Checkbox, ColorInput, Field, IconPicker, NumberInput, Segmented, TextInput } from '../common/fields';
import { IconFramer } from '../common/iconFramer';
import { RangeGrid } from '../common/rangeGrid';
import { UnitToken } from '../common/tokens';
import { DefListPanel, SaveBar } from './DefListPanel';
import type { EditorTabProps } from './EditorApp';
import { OnHitEditor, SkillPicker } from './effectEditors';
import { useListDraft, useSaveShortcut } from './useListDraft';

const SIDE_NAMES: Record<EnemySides, string> = { 3: '三角形', 4: '四边形', 5: '五边形', 6: '六边形' };

/** 敌人编辑：ID + 颜色 + 3~6 边形外观 + 数值 + 攻击方式 + 技能 */
export function EnemyEditor({ onDirtyChange }: EditorTabProps) {
  const draft = useListDraft<EnemyDef>({
    load: loadEnemies,
    save: async (list, renames) => {
      await saveEnemies(list, renames);
      notifySaved('敌人');
    },
    validateId: validateUnitId,
    onDirtyChange,
    label: '敌人',
  });
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [endless, setEndless] = useState<EndlessConfig>(newEndlessConfig);
  useEffect(() => {
    void loadSkills().then(setSkills);
    void loadEndless().then(setEndless);
  }, []);
  useSaveShortcut(() => void draft.saveAll());

  if (draft.loadError) return <div className="page-msg">读取敌人失败：{draft.loadError}</div>;
  if (!draft.items) return <div className="page-msg">加载中…</div>;
  const sel = draft.selected;
  const e = sel?.value;
  const set = (patch: Partial<EnemyDef>) => sel && draft.update(sel.key, patch);
  const ids = draft.items.map((d) => d.value.id);

  return (
    <div className="def-editor">
      <DefListPanel
        title="敌人"
        items={draft.items}
        selectedKey={draft.selectedKey}
        errors={draft.errors}
        onSelect={draft.setSelectedKey}
        onAdd={() => draft.add(newEnemy(nextId('E', ids)), draft.selectedKey)}
        onDuplicate={() => e && draft.add({ ...structuredClone(e), id: nextId(e.id.replace(/\d+$/, '') || 'E', ids), name: `${e.name} 副本` }, draft.selectedKey)}
        onDelete={() => sel && window.confirm(`删除敌人「${e!.name}」（${e!.id}）？\n已放进关卡时间线中的该敌人会被跳过。`) && draft.remove(sel.key)}
        onMove={(d) => sel && draft.move(sel.key, draft.items!.indexOf(sel) + d)}
        renderIcon={(v) => <UnitToken kind="enemy" def={v} size={30} />}
        renderMeta={(v) => <span className="muted small">{v.canAttack ? (v.attackTarget === 'ally' ? '✚' : '⚔') : '—'}</span>}
      />

      {e && sel ? (
        <section className="def-form">
          <div className="form-scroll">
            <h3 className="form-title">基本信息</h3>
            <div className="form-grid">
              <Field label="ID" hint="唯一编号，用于区分敌人">
                <TextInput value={e.id} invalid={draft.errors.has(sel.key)} maxLength={24} onChange={(v) => set({ id: v.trim() })} />
                {draft.errors.has(sel.key) && <span className="field-error">{draft.errors.get(sel.key)}</span>}
              </Field>
              <Field label="名称">
                <TextInput value={e.name} maxLength={20} onChange={(v) => set({ name: v })} />
              </Field>
              <Field label="外形" hint="3 ~ 6 边形" wide>
                <Segmented
                  value={e.sides}
                  options={([3, 4, 5, 6] as EnemySides[]).map((n) => ({
                    value: n,
                    label: (
                      <span className="row gap-xs">
                        <UnitToken kind="enemy" def={{ ...e, sides: n, icon: undefined, size: 1 }} size={22} />
                        {SIDE_NAMES[n]}
                      </span>
                    ),
                  }))}
                  onChange={(v) => set({ sides: v })}
                />
              </Field>
              <Field label="颜色" wide>
                <ColorInput value={e.color} onChange={(v) => set({ color: v })} />
              </Field>
              <Field label="体型" hint="0.5 ~ 2，影响显示大小">
                <NumberInput value={e.size} min={0.5} max={2} step={0.05} onChange={(v) => set({ size: v })} />
              </Field>
              <Field label="图标（可选）" hint="设置后优先显示；上传后在图片上选择中心点" wide block>
                <IconPicker value={e.icon} baseName={e.id} onChange={(v) => set({ icon: v, iconCenter: undefined, iconZoom: undefined })} />
                <IconFramer kind="enemy" def={e} onChange={(p) => set(p)} />
              </Field>
            </div>

            <h3 className="form-title">数值</h3>
            <div className="form-grid cols-4">
              <Field label="生命值">
                <NumberInput value={e.maxHp} min={1} max={999999} integer onChange={(v) => set({ maxHp: v })} />
              </Field>
              <Field label="攻击力" hint={e.attackTarget === 'ally' ? '负数 = 治疗量' : undefined}>
                <NumberInput value={e.atk} min={-99999} max={99999} integer onChange={(v) => set({ atk: v })} />
              </Field>
              <Field label="物抗" hint="负数 = 受到更多物伤">
                <NumberInput value={e.def} min={-99999} max={99999} integer onChange={(v) => set({ def: v })} />
              </Field>
              <Field label="法抗" hint="%，负数 = 受到更多法伤">
                <NumberInput value={e.res} min={RES_MIN} max={100} onChange={(v) => set({ res: v })} />
              </Field>
              <Field label="移动速度" hint="格/秒">
                <NumberInput value={e.speed} min={0.05} max={20} step={0.05} onChange={(v) => set({ speed: v })} />
              </Field>
              <Field label="击杀奖励" hint="负数 = 扣除金钱">
                <NumberInput value={e.reward} min={-9999} max={9999} integer onChange={(v) => set({ reward: v })} />
              </Field>
            </div>

            <h3 className="form-title">无尽模式</h3>
            <div className="form-grid cols-4">
              <Field label="分数" hint="被击败时获得，负数 = 扣分">
                <NumberInput value={e.endlessScore} min={-99999} max={99999} step={1} onChange={(v) => set({ endlessScore: v })} />
              </Field>
              <Field label="敌人难度" hint="越低越早出现">
                <NumberInput value={e.endlessDifficulty} min={-99999} max={99999} step={0.5} onChange={(v) => set({ endlessDifficulty: v })} />
              </Field>
              <Field label="出现位列" hint="越低每组越少、间隔越短">
                <NumberInput value={e.endlessRank} min={1} max={50} integer onChange={(v) => set({ endlessRank: v })} />
              </Field>
              <Field label="预览">
                <EndlessPreview def={e} endless={endless} />
              </Field>
            </div>
            <div className="muted small help-text">
              无尽模式中，当前难度 = 起始难度 + (波次 − 1) × 每波增加；只有「敌人难度」不超过当前难度的敌人会出现，越接近当前难度出现得越多。
              每组的数量 = 出现位列 × 每位列数量（每波还会增加），组内出现间隔 = 出现位列 × 每位列间隔。这些系数在「无尽模式」编辑器中设置。
            </div>

            <h3 className="form-title">攻击方式</h3>
            <div className="form-grid cols-4">
              <Field label="是否攻击" wide>
                <Checkbox
                  checked={e.canAttack}
                  onChange={(v) => set({ canAttack: v })}
                  label={e.canAttack ? (e.attackTarget === 'ally' ? '会攻击 / 治疗其他敌人' : '会攻击角色') : '不会攻击（只管前进）'}
                />
              </Field>
              <Field label="攻击对象" wide>
                <Segmented
                  value={e.attackTarget}
                  options={[
                    { value: 'enemy', label: '攻击角色', title: '默认' },
                    { value: 'ally', label: '攻击队友', title: '对其他敌人生效；攻击力为负数时治疗' },
                  ]}
                  onChange={(v) => set({ attackTarget: v })}
                />
              </Field>
              <Field label="伤害类型" wide>
                <Segmented
                  value={e.damageType}
                  options={[
                    { value: 'physical', label: '物伤' },
                    { value: 'magic', label: '法伤' },
                    { value: 'true', label: '真伤', title: '无视物抗和法抗' },
                  ]}
                  onChange={(v) => set({ damageType: v })}
                />
              </Field>
              <Field label="攻击方式" wide>
                <Segmented
                  value={e.attackType === 'area' ? 'area' : 'basic'}
                  options={listAttackTypes().map((a) => ({ value: a.id, label: a.name, title: a.description }))}
                  onChange={(v) => set({ attackType: v })}
                />
              </Field>
              <Field label="攻击间隔" hint="秒">
                <NumberInput value={e.attackInterval} min={0.05} max={60} step={0.1} disabled={!e.canAttack} onChange={(v) => set({ attackInterval: v })} />
              </Field>
              <Field label="攻击范围" hint="格，按方块；0 = 只打阻挡者">
                <NumberInput value={e.attackRange} min={0} max={20} step={0.5} disabled={!e.canAttack} onChange={(v) => set({ attackRange: v })} />
              </Field>
              <Field label="每次攻击目标数" hint={e.attackType === 'area' ? '范围伤害总是全部' : '-1 = 射程内全部'}>
                <NumberInput value={e.targetCount} min={-1} max={99} integer disabled={!e.canAttack || e.attackType === 'area'} onChange={(v) => set({ targetCount: v === 0 ? 1 : v })} />
              </Field>
              <Field label="说明" wide>
                <div className="static-value">{describeAttack(e)}</div>
              </Field>
              <Field label="命中附带效果（可选）" hint="普通攻击命中时给目标加上增益 / 减益" wide>
                <OnHitEditor value={e.onHit} onChange={(v) => set({ onHit: v })} />
              </Field>
            </div>

            <h3 className="form-title">技能</h3>
            <div className="form-grid">
              <Field label="战斗中使用的技能数" hint="敌人的技能总是 SP 满后自动释放">
                <NumberInput value={e.skillSlots} min={0} max={9} integer onChange={(v) => set({ skillSlots: v })} />
              </Field>
              <Field label="技能" hint="使用前 N 个" wide>
                <SkillPicker value={e.skills} library={skills} slots={e.skillSlots} onChange={(v) => set({ skills: v })} />
              </Field>
              <Field label="描述" wide>
                <textarea className="input" rows={2} value={e.description ?? ''} onChange={(ev) => set({ description: ev.target.value || undefined })} />
              </Field>
            </div>
          </div>
          <SaveBar dirty={draft.dirty} saving={draft.saving} onSave={() => void draft.saveAll()} />
        </section>
      ) : (
        <section className="def-form empty-hint">选择或新建一个敌人</section>
      )}

      {e && <EnemyPreview def={e} />}
    </div>
  );
}

/** 预览：敌人沿一条小路线来回移动，显示实际大小与速度 */
function EnemyPreview({ def }: { def: EnemyDef }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const icon = useIcon(def.icon);
  const defRef = useRef(def);
  defRef.current = def;
  const iconRef = useRef(icon);
  iconRef.current = icon;
  const W = 252;
  const H = 150;

  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext('2d')!;
    let raf = 0;
    let x = 0.5;
    let dir = 1;
    let last = performance.now();
    const cells = 6;
    const cell = W / cells;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const d = defRef.current;
      x += dir * d.speed * dt;
      if (x > cells - 0.5) {
        x = cells - 0.5;
        dir = -1;
      } else if (x < 0.5) {
        x = 0.5;
        dir = 1;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#10141c';
      ctx.fillRect(0, 0, W, H);
      const top = (H - cell * 2) / 2;
      for (let i = 0; i < cells; i++) {
        drawTile(ctx, tileInfo('high'), i * cell, top, cell);
        drawTile(ctx, tileInfo('ground'), i * cell, top + cell, cell);
      }
      const cx = x * cell;
      const cy = top + cell * 1.5;
      if (d.canAttack && d.attackRange > 0) {
        // 射程按方块显示：以敌人当前所在的方块为中心
        const color = d.attackTarget === 'ally' && d.atk < 0 ? '#5dff9d' : d.color;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, top, W, cell * 2);
        ctx.clip();
        drawRangeTiles(ctx, { scale: cell, ox: 0, oy: top - cell }, null, Math.floor(x), 2, d.attackRange, color, 0.9);
        ctx.restore();
      }
      drawEnemyToken(ctx, d, cx, cy, enemyRadius(d) * cell, dir > 0 ? 0 : Math.PI, { icon: iconRef.current });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <aside className="def-preview">
      <div className="panel-head">预览</div>
      <canvas ref={ref} style={{ width: W, height: H }} className="preview-canvas" />
      <div className="preview-caption muted small">按实际速度在地面上移动{def.canAttack && def.attackRange > 0 ? '，高亮方块 = 射程' : ''}</div>
      {def.canAttack && def.attackRange > 0 && (
        <div className="row gap-s center">
          <RangeGrid range={def.attackRange} color={def.attackTarget === 'ally' && def.atk < 0 ? '#5dff9d' : def.color} />
        </div>
      )}
      <dl className="stat-grid">
        <dt>外形</dt>
        <dd>{SIDE_NAMES[def.sides]}</dd>
        <dt>走 10 格用时</dt>
        <dd>{(10 / def.speed).toFixed(1)} 秒</dd>
        <dt>攻击</dt>
        <dd>{def.canAttack ? (def.attackRange > 0 ? `远程 ${def.attackRange} 格` : '近战（只打阻挡者）') : '不攻击'}</dd>
        <dt>方式</dt>
        <dd>{describeAttack(def)}</dd>
        <dt>物抗 / 法抗</dt>
        <dd>
          {def.def} / {def.res}%
        </dd>
      </dl>
      {describeOnHit(def.onHit) && <div className="codex-note small">{describeOnHit(def.onHit)}</div>}
      <div className="preview-sizes">
        {[24, 36, 52].map((s) => (
          <UnitToken key={s} kind="enemy" def={def} size={s} />
        ))}
      </div>
    </aside>
  );
}

/** 无尽模式中这个敌人第一次出现的波次，以及第 1 波 / 第 10 波时每组的数量和间隔 */
function EndlessPreview({ def, endless }: { def: EnemyDef; endless: EndlessConfig }) {
  const first = firstWaveOf(endless, def.endlessDifficulty);
  const g1 = groupSize(endless, def.endlessRank, Math.max(1, first ?? 1));
  return (
    <div className="static-value small">
      {first == null ? '不会出现（难度太高）' : `第 ${first} 波起出现`} · 每组 {g1.count} 个{g1.count > 1 ? `，间隔 ${g1.interval} 秒` : ''}
    </div>
  );
}
