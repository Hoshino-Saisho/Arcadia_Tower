import { useEffect, useRef } from 'react';
import type { CharacterDef, EnemyDef } from '../../core/types';
import { useIcon } from '../../game/icons';
import { drawCharacterToken, drawEnemyToken } from '../../game/shapes';

/**
 * 角色 / 敌人的小图标（Canvas 绘制，与游戏内完全一致：有图标显示图标，否则显示形状）
 */
export function UnitToken({
  kind,
  def,
  size = 32,
  angle = -Math.PI / 2,
  label = true,
  dim = false,
}: {
  kind: 'character' | 'enemy';
  def: CharacterDef | EnemyDef;
  size?: number;
  angle?: number;
  label?: boolean;
  dim?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const icon = useIcon(def.icon);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    if (kind === 'character') {
      drawCharacterToken(ctx, def as CharacterDef, size / 2, size / 2 - size * 0.04, size * 0.38, {
        icon,
        label: label ? def.name.slice(0, 1) : undefined,
        alpha: dim ? 0.45 : 1,
      });
    } else {
      const e = def as EnemyDef;
      const r = size * 0.36 * Math.min(1.25, Math.max(0.75, e.size));
      drawEnemyToken(ctx, e, size / 2, size / 2, r, angle, { icon, alpha: dim ? 0.45 : 1 });
    }
  }, [kind, def, size, angle, icon, label, dim]);
  return <canvas ref={ref} className="unit-token" style={{ width: size, height: size }} />;
}
