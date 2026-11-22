import { useEffect, useRef, useState, type ReactNode } from 'react';
import { importIcon } from '../../core/storage/repository';
import { iconStatus, useIcon } from '../../game/icons';
import { toast } from './toast';

export function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' field-wide' : ''}`}>
      <span className="field-label">
        {label}
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** 数字输入：输入过程中允许临时的非法值，失焦/回车时提交并限制范围 */
export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  integer = false,
  disabled,
  width,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  disabled?: boolean;
  width?: number;
}) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    let n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) {
      setText(String(value));
      return;
    }
    if (integer) n = Math.round(n);
    n = Math.min(max, Math.max(min, n));
    n = Math.round(n * 1000) / 1000;
    setText(String(n));
    if (n !== value) onChange(n);
  };

  return (
    <input
      className="input num"
      type="number"
      value={text}
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      step={step}
      disabled={disabled}
      style={width ? { width } : undefined}
      onFocus={() => (focused.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n))) {
          onChange(n);
        }
      }}
      onBlur={(e) => {
        focused.current = false;
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  invalid,
  maxLength,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
  maxLength?: number;
  onBlur?: () => void;
}) {
  return (
    <input
      className={`input${invalid ? ' invalid' : ''}`}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}

/** 调色盘：系统取色器 + 十六进制输入 + 常用颜色 */
export const PALETTE = [
  '#e5484d', '#d0743c', '#f0ad4e', '#e8d44d', '#8bc34a', '#2fb380', '#26a69a', '#29b6f6',
  '#3a8ee6', '#5c6bc0', '#9b59d0', '#d65db1', '#8d6e63', '#7f8c8d', '#cfd8dc', '#37474f',
];

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = /^#[0-9a-fA-F]{6}$/.test(text);
  return (
    <div className="color-input">
      <div className="color-row">
        <input type="color" className="color-picker" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888'} onChange={(e) => onChange(e.target.value)} />
        <input
          className={`input mono${valid ? '' : ' invalid'}`}
          value={text}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
            setText(v);
            if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
          }}
          onBlur={() => setText(value)}
        />
      </div>
      <div className="swatches">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch${c.toLowerCase() === value.toLowerCase() ? ' active' : ''}`}
            style={{ background: c }}
            title={c}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </div>
  );
}

/** 图标选择：把图片复制到 data/icons/ 并返回相对路径 */
export function IconPicker({ value, baseName, onChange }: { value?: string; baseName: string; onChange: (v: string | undefined) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const img = useIcon(value);
  const status = iconStatus(value);
  return (
    <div className="icon-picker">
      <div className="icon-thumb">{img ? <img src={img.src} alt="" /> : <span>{value ? (status === 'error' ? '加载失败' : '…') : '无'}</span>}</div>
      <div className="icon-actions">
        <div className="icon-path mono" title={value}>
          {value ? (value.startsWith('data:') ? '(内嵌图片)' : value) : '未设置（使用默认形状）'}
        </div>
        <div className="row gap-s">
          <button type="button" className="btn btn-s" onClick={() => fileRef.current?.click()}>
            选择图片…
          </button>
          {value && (
            <button type="button" className="btn btn-s btn-ghost" onClick={() => onChange(undefined)}>
              清除
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const rel = await importIcon(f, baseName);
            onChange(rel);
            toast(`图标已保存到 ${rel}`, 'ok');
          } catch (err) {
            toast(`导入图标失败：${String(err)}`, 'error');
          }
        }}
      />
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} type="button" title={o.title} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
