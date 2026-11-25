import { useEffect, useRef, useState } from 'react';
import { RES_MIN, newCharacter, retreatRefund } from '../../core/defaults';
import { describeAttack, describeOnHit } from '../../core/describe';
import { notifySaved } from '../../core/github/sync';
import { nextId, validateUnitId } from '../../core/ids';
import { leveledCharacter } from '../../core/leveling';
import { loadCharacters, loadCurrency, loadSkills, saveCharacters } from '../../core/storage/repository';
import { tileInfo } from '../../core/tiles';
import type { CharacterDef, CharacterGrowth, PlacementType, SkillDef } from '../../core/types';
import { listAttackTypes } from '../../game/attacks';
import { useIcon } from '../../game/icons';
import { drawRangeTiles } from '../../game/renderer';
import { drawCharacterToken, drawTile } from '../../game/shapes';
import { ColorInput, Field, IconPicker, NumberInput, Segmented, TextInput } from '../common/fields';
import { IconFramer } from '../common/iconFramer';
import { RangeGrid } from '../common/rangeGrid';
import { UnitToken } from '../common/tokens';
import { DefListPanel, SaveBar } from './DefListPanel';
import type { EditorTabProps } from './EditorApp';
import { OnHitEditor, SkillPicker } from './effectEditors';
import { useListDraft, useSaveShortcut } from './useListDraft';

const PLACEMENTS: { value: PlacementType; label: string; title: string }[] = [
  { value: 'ground', label: '地面', title: '只能部署在地面方块上，可以阻挡敌人' },
  { value: 'high', label: '高台', title: '只能部署在高台方块上，不阻挡敌人' },
  { value: 'any', label: '均可', title: '地面和高台都可以部署' },
];

/** 角色编辑：用 ID 区分，没有图标时用颜色圆形显示 */
export function CharacterEditor({ onDirtyChange }: EditorTabProps) {
  const draft = useListDraft<CharacterDef>({
    load: loadCharacters,
    save: async (list, renames) => {
      await saveCharacters(list, renames);
      notifySaved('角色');
    },
    validateId: validateUnitId,
    onDirtyChange,
    label: '角色',
  });
  const [skills, setSkills] = useState<SkillDef[]>([]);
  const [maxLevel, setMaxLevel] = useState(20);
  useEffect(() => {
    void loadSkills().then(setSkills);
    void loadCurrency().then((c) => setMaxLevel(c.maxLevel));
  }, []);
  useSaveShortcut(() => void draft.saveAll());

  if (draft.loadError) return <div className="page-msg">读取角色失败：{draft.loadError}</div>;
  if (!draft.items) return <div className="page-msg">加载中…</div>;
  const sel = draft.selected;
  const c = sel?.value;
  const set = (patch: Partial<CharacterDef>) => sel && draft.update(sel.key, patch);
  const setGrowth = (patch: Partial<CharacterGrowth>) => c && set({ growth: { ...c.growth, ...patch } });
  const ids = draft.items.map((d) => d.value.id);
  const healer = c?.attackTarget === 'ally' && c.atk < 0;

  return (
    <div className="def-editor">
      <DefListPanel
        title="角色"
        items={draft.items}
        selectedKey={draft.selectedKey}
        errors={draft.errors}
        onSelect={draft.setSelectedKey}
        onAdd={() => draft.add(newCharacter(nextId('C', ids)), draft.selectedKey)}
        onDuplicate={() => c && draft.add({ ...structuredClone(c), id: nextId(c.id.replace(/\d+$/, '') || 'C', ids), name: `${c.name} 副本` }, draft.selectedKey)}
        onDelete={() => sel && window.confirm(`删除角色「${c!.name}」（${c!.id}）？`) && draft.remove(sel.key)}
        onMove={(d) => sel && draft.move(sel.key, draft.items!.indexOf(sel) + d)}
        renderIcon={(v) => <UnitToken kind="character" def={v} size={30} />}
        renderMeta={(v) => <span className="cost-chip">{v.cost}</span>}
      />

      {c && sel ? (
        <section className="def-form">
          <div className="form-scroll">
            <h3 className="form-title">基本信息</h3>
            <div className="form-grid">
              <Field label="ID" hint="唯一编号，用于区分角色">
                <TextInput value={c.id} invalid={draft.errors.has(sel.key)} maxLength={24} onChange={(v) => set({ id: v.trim() })} />
                {draft.errors.has(sel.key) && <span className="field-error">{draft.errors.get(sel.key)}</span>}
              </Field>
              <Field label="名称">
                <TextInput value={c.name} maxLength={20} onChange={(v) => set({ name: v })} />
              </Field>
              <Field label="颜色" hint="没有图标时显示为该颜色的圆形" wide>
                <ColorInput value={c.color} onChange={(v) => set({ color: v })} />
              </Field>
              <Field label="图标（可选）" hint="设置后优先显示；上传后在图片上选择中心点" wide block>
                <IconPicker value={c.icon} baseName={c.id} onChange={(v) => set({ icon: v, iconCenter: undefined, iconZoom: undefined })} />
                <IconFramer kind="character" def={c} onChange={(p) => set(p)} />
              </Field>
            </div>

            <h3 className="form-title">数值</h3>
            <div className="form-grid cols-4">
              <Field label="费用" hint="负数 = 部署时获得金钱">
                <NumberInput value={c.cost} min={-9999} max={9999} integer onChange={(v) => set({ cost: v })} />
              </Field>
              <Field label="生命值">
                <NumberInput value={c.maxHp} min={1} max={999999} integer onChange={(v) => set({ maxHp: v })} />
              </Field>
              <Field label="攻击力" hint={c.attackTarget === 'ally' ? '负数 = 治疗量' : undefined}>
                <NumberInput value={c.atk} min={-99999} max={99999} integer onChange={(v) => set({ atk: v })} />
              </Field>
              <Field label="物抗" hint="负数 = 受到更多物伤">
                <NumberInput value={c.def} min={-99999} max={99999} integer onChange={(v) => set({ def: v })} />
              </Field>
              <Field label="法抗" hint="%，负数 = 受到更多法伤">
                <NumberInput value={c.res} min={RES_MIN} max={100} onChange={(v) => set({ res: v })} />
              </Field>
              <Field label="攻击间隔" hint="秒">
                <NumberInput value={c.attackInterval} min={0.05} max={60} step={0.1} onChange={(v) => set({ attackInterval: v })} />
              </Field>
              <Field label="攻击范围" hint="格，按方块计算">
                <NumberInput value={c.range} min={0} max={20} step={0.5} onChange={(v) => set({ range: v })} />
              </Field>
              <Field label="阻挡数" hint="地面部署时">
                <NumberInput value={c.blockCount} min={0} max={10} integer onChange={(v) => set({ blockCount: v })} />
              </Field>
              <Field label="同时部署上限" hint="0 = 不限">
                <NumberInput value={c.maxDeploy} min={0} max={99} integer onChange={(v) => set({ maxDeploy: v })} />
              </Field>
              <Field label="部署冷却" hint="秒，0 = 无">
                <NumberInput value={c.deployCooldown} min={0} max={3600} step={1} onChange={(v) => set({ deployCooldown: v })} />
              </Field>
            </div>
            <div className="form-grid">
              <Field label="部署位置" wide>
                <Segmented value={c.placement} options={PLACEMENTS} onChange={(v) => set({ placement: v })} />
              </Field>
            </div>

            <h3 className="form-title">攻击方式</h3>
            <div className="form-grid cols-4">
              <Field label="攻击对象" wide>
                <Segmented
                  value={c.attackTarget}
                  options={[
                    { value: 'enemy', label: '攻击敌人', title: '默认' },
                    { value: 'ally', label: '攻击队友', title: '按攻击力对队友造成伤害；攻击力为负数时治疗' },
                  ]}
                  onChange={(v) => set({ attackTarget: v })}
                />
              </Field>
              <Field label="伤害类型" wide>
                <Segmented
                  value={c.damageType}
                  options={[
                    { value: 'physical', label: '物伤', title: '被物抗减免，无视法抗' },
                    { value: 'magic', label: '法伤', title: '被法抗减免，无视物抗' },
                    { value: 'true', label: '真伤', title: '无视物抗和法抗' },
                  ]}
                  onChange={(v) => set({ damageType: v })}
                />
              </Field>
              <Field label="攻击方式" wide>
                <Segmented
                  value={c.attackType === 'area' ? 'area' : 'basic'}
                  options={listAttackTypes().map((a) => ({ value: a.id, label: a.name, title: a.description }))}
                  onChange={(v) => set({ attackType: v })}
                />
              </Field>
              <Field label="每次攻击目标数" hint={c.attackType === 'area' ? '范围伤害总是攻击射程内全部' : '-1 = 射程内全部'}>
                <NumberInput value={c.targetCount} min={-1} max={99} integer disabled={c.attackType === 'area'} onChange={(v) => set({ targetCount: v === 0 ? 1 : v })} />
              </Field>
              <Field label="说明" wide>
                <div className="static-value">{describeAttack(c)}</div>
              </Field>
              <Field label="命中附带效果（可选）" hint="普通攻击命中时给目标加上增益 / 减益" wide>
                <OnHitEditor value={c.onHit} onChange={(v) => set({ onHit: v })} />
              </Field>
            </div>

            <h3 className="form-title">升级成长</h3>
            <div className="form-grid cols-4">
              <Field label="每级生命值" hint="负数 = 减少">
                <NumberInput value={c.growth.maxHp} min={-99999} max={99999} integer onChange={(v) => setGrowth({ maxHp: v })} />
              </Field>
              <Field label={healer ? '每级治疗量' : '每级攻击力'} hint="负数 = 减少">
                <NumberInput value={c.growth.atk} min={-99999} max={99999} integer onChange={(v) => setGrowth({ atk: v })} />
              </Field>
              <Field label="每级物抗" hint="负数 = 减少">
                <NumberInput value={c.growth.def} min={-99999} max={99999} integer onChange={(v) => setGrowth({ def: v })} />
              </Field>
              <Field label="每级法抗" hint="%，负数 = 减少">
                <NumberInput value={c.growth.res} min={-100} max={100} step={0.5} onChange={(v) => setGrowth({ res: v })} />
              </Field>
              <Field label="成长预览" wide>
                <GrowthPreview def={c} maxLevel={maxLevel} />
              </Field>
            </div>
            <div className="muted small help-text">
              玩家用经验书给角色升级，每升 1 级基础数值增加上面的数值（负数 = 减少；生命最少 1，攻击力 / 治疗量最少减到 0，物抗 / 法抗可以减到负数）。等级上限、升级经验和经验书在「货币编辑」中设置。
            </div>

            <h3 className="form-title">技能</h3>
            <div className="form-grid">
              <Field label="战斗中可携带的技能数" hint="玩家可以在游戏的「角色设定」中选择">
                <NumberInput value={c.skillSlots} min={0} max={9} integer onChange={(v) => set({ skillSlots: v })} />
              </Field>
              <Field label="可用技能" hint="排在前面的默认携带" wide>
                <SkillPicker value={c.skills} library={skills} slots={c.skillSlots} onChange={(v) => set({ skills: v })} />
              </Field>
              <Field label="描述" wide>
                <textarea className="input" rows={2} value={c.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} />
              </Field>
            </div>
          </div>
          <SaveBar dirty={draft.dirty} saving={draft.saving} onSave={() => void draft.saveAll()} />
        </section>
      ) : (
        <section className="def-form empty-hint">选择或新建一个角色</section>
      )}

      {c && <CharacterPreview def={c} healer={!!healer} skills={skills} />}
    </div>
  );
}

/** 成长预览：1 级 / 10 级 / 满级的数值 */
function GrowthPreview({ def, maxLevel }: { def: CharacterDef; maxLevel: number }) {
  const healer = def.attackTarget === 'ally' && def.atk < 0;
  const levels = [...new Set([1, Math.min(10, maxLevel), maxLevel])];
  return (
    <div className="growth-preview">
      {levels.map((lv) => {
        const d = leveledCharacter(def, lv);
        return (
          <span key={lv} className="growth-cell">
            <strong>Lv.{lv}</strong> 生命 {d.maxHp} · {healer ? '治疗' : '攻击'} {Math.abs(d.atk)} · 物抗 {d.def} · 法抗 {d.res}%
          </span>
        );
      })}
    </div>
  );
}

/** 右侧预览：7×7 方块中心放置角色，并画出攻击范围 */
function CharacterPreview({ def, healer, skills }: { def: CharacterDef; healer: boolean; skills: SkillDef[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const icon = useIcon(def.icon);
  const size = 252;
  useEffect(() => {
    const cv = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#10141c';
    ctx.fillRect(0, 0, size, size);
    const n = Math.max(7, Math.min(13, Math.ceil(def.range + 1e-6) * 2 + 3));
    const cell = size / n;
    const centerType = def.placement === 'high' ? 'high' : 'ground';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const isCenter = x === (n - 1) / 2 && y === (n - 1) / 2;
        const t = isCenter ? centerType : y === (n - 1) / 2 ? 'ground' : 'high';
        drawTile(ctx, tileInfo(t), x * cell, y * cell, cell);
      }
    }
    const cx = size / 2;
    const cy = size / 2;
    // 射程按方块显示（和游戏中一致）
    const mid = (n - 1) / 2;
    drawRangeTiles(ctx, { scale: cell, ox: 0, oy: 0 }, null, mid, mid, def.range, healer ? '#5dff9d' : def.color);
    drawCharacterToken(ctx, def, cx, cy, cell * 0.36, { icon, label: def.name.slice(0, 1) });
  }, [def, icon, healer]);

  const perSec = def.attackInterval > 0 ? Math.abs(def.atk) / def.attackInterval : 0;
  const targets = def.targetCount < 0 ? '全部' : def.targetCount;
  const names = def.skills.map((id) => skills.find((s) => s.id === id)?.name ?? `${id}（不存在）`);
  return (
    <aside className="def-preview">
      <div className="panel-head">预览</div>
      <canvas ref={ref} style={{ width: size, height: size }} className="preview-canvas" />
      <div className="preview-caption muted small">高亮方块 = 射程（{def.range} 格，按方块计算）</div>
      <div className="row gap-s center">
        <RangeGrid range={def.range} color={healer ? '#5dff9d' : def.color} />
      </div>
      <dl className="stat-grid">
        <dt>{healer ? '每秒治疗' : '每秒伤害'}</dt>
        <dd>
          {perSec.toFixed(1)} × {targets}
        </dd>
        <dt>攻击方式</dt>
        <dd>{describeAttack(def)}</dd>
        <dt>物抗 / 法抗</dt>
        <dd>
          {def.def} / {def.res}%
        </dd>
        <dt>阻挡</dt>
        <dd>{def.placement === 'high' ? '高台不阻挡' : `${def.blockCount} 个`}</dd>
        <dt>撤退返还</dt>
        <dd>{retreatRefund(def.cost)}</dd>
        <dt>部署冷却</dt>
        <dd>{def.deployCooldown > 0 ? `${def.deployCooldown} 秒` : '无'}</dd>
        <dt>技能</dt>
        <dd>{names.length ? `${names.join('、')}（带 ${def.skillSlots} 个）` : '无'}</dd>
      </dl>
      {describeOnHit(def.onHit) && <div className="codex-note small">{describeOnHit(def.onHit)}</div>}
      <div className="preview-sizes">
        {[24, 36, 52].map((s) => (
          <UnitToken key={s} kind="character" def={def} size={s} />
        ))}
      </div>
    </aside>
  );
}
