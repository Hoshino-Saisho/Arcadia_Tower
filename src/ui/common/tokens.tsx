import { useEffect, useRef } from 'react';
import type { CharacterDef, EnemyDef } from '../../core/types';
import { useIcon } from '../../game/icons';
import { drawCharacterToken, drawEnemyToken, drawImageToken } from '../../game/shapes';

/**
 * 角色 / 敌人的小图标（Canvas 绘制，与游戏内一致：有图标时显示方形的图片（铺满图标框），否则显示形状）
 */
export function UnitToken({
  kind,
  def,
  size = 32,
  angle = -Math.PI / 2,
  label = true,
  dim = false,
}: {
  /** summon = 召唤物（比角色小，中间没有字） */
  kind: 'character' | 'enemy' | 'summon';
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
    if (icon) {
      // 图片：和地图上 3×3 格的方形是同一个取景，缩小到图标框的大小
      drawImageToken(ctx, icon, def, size / 2, size / 2, size, { alpha: dim ? 0.45 : 1 });
    } else if (kind === 'character' || kind === 'summon') {
      drawCharacterToken(ctx, def as CharacterDef, size / 2, size / 2 - size * 0.04, size * (kind === 'summon' ? 0.29 : 0.38), {
        icon,
        label: label && kind === 'character' ? def.name.slice(0, 1) : undefined,
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
