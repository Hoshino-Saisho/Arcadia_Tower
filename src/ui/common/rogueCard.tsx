import type { ReactNode } from 'react';
import { rogueEffectLabel, rogueStepText, rogueValueText } from '../../core/rogue';
import type { RogueCard } from '../../core/types';
import { outlinedText } from '../../game/shapes';

/**
 * 一张肉鸽牌（战斗中的三选一、持有的牌、无尽模式介绍、编辑器预览共用）：
 * 名称、等级、每个效果的数值（升级时显示「原来 → 升级后」）和每次升级增加多少、升级进度、描述。
 * 等级没有上限。
 */
export function RogueCardFace({
  card,
  level,
  from,
  copies = 0,
  badge,
  hotkey,
  compact = false,
  onClick,
}: {
  card: RogueCard;
  /** 显示的等级 */
  level: number;
  /** 升级前的等级：设置时效果显示「原来 → 升级后」 */
  from?: number;
  /** 当前等级的升级进度（已经再抽到几张） */
  copies?: number;
  /** 右上角的标记（新 / 升级 / 升级进度） */
  badge?: ReactNode;
  /** 左上角的快捷键 */
  hotkey?: string;
  /** 小尺寸（持有的牌列表） */
  compact?: boolean;
  onClick?: () => void;
}) {
  const need = Math.max(1, card.copies);
  const upgrading = from != null && from !== level;
  const body = (
    <>
      <span className="rogue-card-head">
        {hotkey && <span className="rogue-card-key mono">{hotkey}</span>}
        <span className="rogue-card-name" style={outlinedText(card.color)}>
          {card.name}
        </span>
        <span className="rogue-card-lv mono">Lv.{level}</span>
        {badge && <span className="rogue-card-badge">{badge}</span>}
      </span>
      <span className="rogue-card-effects">
        {card.effects.map((e, i) => {
          const step = rogueStepText(e);
          return (
            <span key={i} className="rogue-card-effect">
              <span className="rogue-effect-label">{rogueEffectLabel(e)}</span>
              <span className={`rogue-effect-value mono${upgrading ? ' up' : ''}`}>
                {upgrading && (
                  <>
                    <s>{rogueValueText(e, from!)}</s> →{' '}
                  </>
                )}
                {rogueValueText(e, level)}
              </span>
              {step && <small className="rogue-effect-step">每级 {step}</small>}
            </span>
          );
        })}
        {!card.effects.length && <span className="muted small">（没有效果）</span>}
      </span>
      <span className="rogue-card-progress small" title={`再抽到 ${need - copies} 张同样的牌升到 Lv.${level + 1}（等级没有上限）`}>
        <span className="rogue-pips">
          {Array.from({ length: Math.min(need, 12) }, (_, i) => (
            <span key={i} className={`rogue-pip${i < copies ? ' on' : ''}`} style={i < copies ? { background: card.color } : undefined} />
          ))}
        </span>
        <span className="muted">
          升到 Lv.{level + 1}：{copies}/{need}
        </span>
      </span>
      {!compact && card.description && <span className="rogue-card-desc muted small">{card.description}</span>}
    </>
  );
  const cls = `rogue-card${compact ? ' compact' : ''}${onClick ? ' pickable' : ''}`;
  const style = { ['--card-color' as string]: card.color };
  return onClick ? (
    <button type="button" className={cls} style={style} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
