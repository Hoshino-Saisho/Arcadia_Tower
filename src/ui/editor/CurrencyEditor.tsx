import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newBook } from '../../core/defaults';
import { notifySaved } from '../../core/github/sync';
import { nextId } from '../../core/ids';
import { dropTier, expTable, formatCount, formatDrop, totalExpTo } from '../../core/leveling';
import { loadCurrency, saveCurrency } from '../../core/storage/repository';
import type { CurrencyConfig, DropDisplay, ExpBookDef } from '../../core/types';
import { ColorInput, Field, NumberInput, Segmented, TextInput } from '../common/fields';
import { toast } from '../common/toast';
import { CurrencyBadge } from '../common/wallet';
import { SaveBar } from './DefListPanel';
import type { EditorTabProps } from './EditorApp';
import { DropListEditor } from './rewardEditors';
import { useSaveShortcut } from './useListDraft';

const BOOK_COLORS = ['#6aa84f', '#5b9bd5', '#b07ad9', '#e8a33d', '#d1605e', '#4fb3a9'];

/**
 * 货币编辑：游戏外货币、经验书、角色升级经验、关卡默认的通关奖励（data/currency.json）。
 *  - 升级经验：基础升级经验（1 → 2 级，全部角色通用），之后每一级 = 上一级 × (1 + 增长)
 *  - 经验书：每本增加固定经验，使用时每本消耗一定的货币
 *  - 基础通关奖励（1 倍）：固定获得的货币 + 按概率掉落的经验书；每个关卡在「地图规划 → 关卡设置」中设置倍数
 */
export function CurrencyEditor({ onDirtyChange }: EditorTabProps) {
  const [cfg, setCfg] = useState<CurrencyConfig | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;

  const setDirty = useCallback((d: boolean) => {
    setDirtyState(d);
    onDirtyRef.current(d);
  }, []);

  useEffect(() => {
    loadCurrency().then(setCfg, (e) => setError(String(e)));
  }, []);

  const set = (patch: Partial<CurrencyConfig>) => {
    setCfg((c) => (c ? { ...c, ...patch } : c));
    setDirty(true);
  };

  const problems = useMemo(() => {
    if (!cfg) return [];
    const out: string[] = [];
    if (!cfg.name.trim()) out.push('货币名称不能为空');
    cfg.books.forEach((b) => !b.name.trim() && out.push(`经验书 ${b.id} 没有名称`));
    const ids = new Set(cfg.books.map((b) => b.id));
    if (cfg.defaultBooks.some((d) => !ids.has(d.bookId))) out.push('基础掉落中有已删除的经验书');
    return out;
  }, [cfg]);

  const save = async () => {
    if (!cfg || saving) return;
    if (problems.length) return toast(`无法保存：${problems[0]}`, 'error');
    setSaving(true);
    try {
      await saveCurrency({ ...cfg, name: cfg.name.trim() });
      setDirty(false);
      toast('货币设置已保存', 'ok');
      notifySaved('货币');
    } catch (err) {
      toast(`保存失败：${String(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };
  useSaveShortcut(() => void save());

  if (error) return <div className="page-msg">读取货币设置失败：{error}</div>;
  if (!cfg) return <div className="page-msg">加载中…</div>;

  const setBook = (id: string, patch: Partial<ExpBookDef>) => set({ books: cfg.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  const addBook = () => {
    const id = nextId('B', cfg.books.map((b) => b.id));
    set({ books: [...cfg.books, newBook(id, `经验书 ${cfg.books.length + 1}`, 100, 10, BOOK_COLORS[cfg.books.length % BOOK_COLORS.length])] });
  };
  const removeBook = (b: ExpBookDef) => {
    if (!window.confirm(`删除经验书「${b.name}」？\n玩家已有的这种经验书将无法使用，关卡掉落中的这一项也会失效。`)) return;
    set({ books: cfg.books.filter((x) => x.id !== b.id), defaultBooks: cfg.defaultBooks.filter((d) => d.bookId !== b.id) });
  };

  return (
    <div className="currency-editor">
      <section className="def-form">
        <div className="form-scroll">
          <h3 className="form-title">游戏外货币</h3>
          <div className="form-grid">
            <Field label="名称" hint="通关获得，使用经验书时消耗；和战斗中的「金钱」不同">
              <TextInput value={cfg.name} maxLength={12} invalid={!cfg.name.trim()} onChange={(v) => set({ name: v })} />
            </Field>
            <Field label="显示效果">
              <div className="static-value">
                <CurrencyBadge name={cfg.name || '货币'} color={cfg.color} amount={1250} />
              </div>
            </Field>
            <Field label="颜色" wide>
              <ColorInput value={cfg.color} onChange={(v) => set({ color: v })} />
            </Field>
          </div>

          <h3 className="form-title">角色升级</h3>
          <div className="form-grid cols-3">
            <Field label="基础升级经验" hint="1 级升 2 级，全部角色通用">
              <NumberInput value={cfg.baseExp} min={1} max={1e9} integer onChange={(v) => set({ baseExp: v })} />
            </Field>
            <Field label="每级增长" hint={`每一级 = 上一级 × ${formatFactor(1 + cfg.expGrowth)}`}>
              <NumberInput value={cfg.expGrowth} min={0} max={10} step={0.05} onChange={(v) => set({ expGrowth: v })} />
            </Field>
            <Field label="等级上限">
              <NumberInput value={cfg.maxLevel} min={1} max={999} integer onChange={(v) => set({ maxLevel: v })} />
            </Field>
          </div>
          <div className="muted small help-text">
            例：基础 {cfg.baseExp}、增长 {cfg.expGrowth} → 1→2 级需要 {formatCount(cfg.baseExp)}，2→3 级需要 {formatCount(expTable({ ...cfg, maxLevel: Math.max(3, cfg.maxLevel) })[2])}，以此类推。每升 1 级角色增加的数值在「角色编辑 → 升级成长」中设置。
          </div>

          <h3 className="form-title">经验书</h3>
          <div className="book-table">
            <div className="book-row head">
              <span>颜色</span>
              <span>名称</span>
              <span>每本经验</span>
              <span>每本消耗{cfg.name}</span>
              <span>ID</span>
              <span />
            </div>
            {cfg.books.map((b) => (
              <div key={b.id} className="book-row">
                <input type="color" className="color-picker small" value={/^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#888888'} onChange={(e) => setBook(b.id, { color: e.target.value })} />
                <TextInput value={b.name} maxLength={16} invalid={!b.name.trim()} onChange={(v) => setBook(b.id, { name: v })} />
                <NumberInput value={b.exp} min={1} max={1e9} integer onChange={(v) => setBook(b.id, { exp: v })} />
                <NumberInput value={b.cost} min={0} max={1e9} integer onChange={(v) => setBook(b.id, { cost: v })} />
                <span className="mono muted small" title="自动生成，不能修改">
                  {b.id}
                </span>
                <button className="icon-btn" onClick={() => removeBook(b)} aria-label="删除经验书" title="删除经验书">
                  ×
                </button>
              </div>
            ))}
            {cfg.books.length === 0 && <div className="muted small">还没有经验书</div>}
          </div>
          <button className="btn btn-s" onClick={addBook}>
            + 新建经验书
          </button>

          <h3 className="form-title">基础通关奖励（1 倍）</h3>
          <div className="muted small help-text">
            这里是奖励的基础单位。每个关卡在「地图规划 → 关卡设置」中设置「通关奖励倍数」：本关奖励 = 基础奖励 × 倍数（货币和经验书的数量都乘以倍数，掉落概率不变）。每次通关都会获得。
          </div>
          <div className="form-grid">
            <Field label={`基础${cfg.name}`} hint="1 倍时每次通关固定获得">
              <NumberInput value={cfg.defaultCurrency} min={0} max={1e9} integer onChange={(v) => set({ defaultCurrency: v })} />
            </Field>
            <Field label="关卡选择中的掉落显示" hint="玩家看到的掉落信息">
              <Segmented<DropDisplay>
                value={cfg.dropDisplay}
                options={[
                  { value: 'exact', label: '精确数值', title: '显示概率百分比和数量范围' },
                  { value: 'tier', label: '概率等级', title: '固定 / 大概率（≥50%）/ 小概率（≥20%）/ 罕见' },
                  { value: 'hidden', label: '不显示', title: '关卡选择中不显示掉落' },
                ]}
                onChange={(v) => set({ dropDisplay: v })}
              />
            </Field>
            <Field label="基础经验书掉落" hint="每一项按概率掉落，数量在范围内随机（再乘以关卡倍数）" wide block>
              <DropListEditor value={cfg.defaultBooks} books={cfg.books} onChange={(v) => set({ defaultBooks: v })} />
            </Field>
          </div>
          {problems.length > 0 && (
            <ul className="check-list">
              {problems.map((p) => (
                <li key={p} className="err">
                  ✗ {p}
                </li>
              ))}
            </ul>
          )}
        </div>
        <SaveBar dirty={dirty} saving={saving} onSave={() => void save()} />
      </section>

      <CurrencyPreview cfg={cfg} />
    </div>
  );
}

function formatFactor(f: number): string {
  return String(Math.round(f * 1000) / 1000);
}

/** 右侧预览：升级经验表、升到某一级需要多少经验书和货币、默认掉落的显示效果 */
function CurrencyPreview({ cfg }: { cfg: CurrencyConfig }) {
  const table = useMemo(() => expTable(cfg), [cfg]);
  const target = Math.min(10, cfg.maxLevel);
  const need = totalExpTo(cfg, target, table);
  return (
    <aside className="def-preview currency-preview">
      <div className="panel-head">升级经验表</div>
      <div className="exp-table">
        <div className="exp-row head">
          <span>等级</span>
          <span>升级所需</span>
          <span>累计</span>
        </div>
        {table.slice(1).map((req, i) => (
          <div key={i} className="exp-row">
            <span className="mono">
              {i + 1}→{i + 2}
            </span>
            <span className="mono">{formatCount(req)}</span>
            <span className="mono muted">{formatCount(totalExpTo(cfg, i + 2, table))}</span>
          </div>
        ))}
        {cfg.maxLevel <= 1 && <div className="muted small">等级上限为 1，角色不能升级</div>}
      </div>
      {target > 1 && cfg.books.length > 0 && (
        <>
          <div className="panel-head">从 1 级升到 {target} 级</div>
          <div className="muted small">共需 {formatCount(need)} 经验，相当于：</div>
          <ul className="preview-list small">
            {cfg.books.map((b) => {
              const n = Math.ceil(need / Math.max(1, b.exp));
              return (
                <li key={b.id}>
                  <span className="color-dot" style={{ background: b.color }} /> {b.name} × {formatCount(n)}，消耗 {formatCount(n * b.cost)} {cfg.name}
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="panel-head">关卡选择中的显示（1 倍）</div>
      <div className="small">
        {cfg.dropDisplay === 'hidden' ? (
          <span className="muted">不显示掉落</span>
        ) : (
          <div className="reward-chips">
            <CurrencyBadge name={cfg.name} color={cfg.color} amount={cfg.defaultCurrency} />
            {cfg.defaultBooks.map((d, i) => {
              const b = cfg.books.find((x) => x.id === d.bookId);
              return b ? (
                <span key={i} className="book-chip" style={{ borderColor: b.color }} title={`${dropTier(d.chance)} · ${d.chance}%`}>
                  <span className="color-dot" style={{ background: b.color }} />
                  {formatDrop(d, b, cfg.dropDisplay)}
                </span>
              ) : null;
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
