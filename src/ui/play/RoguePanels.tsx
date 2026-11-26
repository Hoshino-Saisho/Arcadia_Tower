import { gainCard, nextDrawWave } from '../../core/rogue';
import type { GameEngine } from '../../game/engine';
import { RogueCardFace } from '../common/rogueCard';

/** 肉鸽：抽到的牌（N 选 1）。选择前战斗暂停；数字键也可以选择 */
export function RogueDraw({ engine, onPick }: { engine: GameEngine; onPick: (id: string | null) => void }) {
  const offer = engine.offer;
  const cfg = engine.rogue;
  if (!offer || !cfg) return null;
  const full = cfg.maxHeld > 0 && engine.held.length >= cfg.maxHeld;
  return (
    <div className="result-overlay rogue-overlay">
      <div className="rogue-draw">
        <div className="rogue-draw-title">
          <span className="accent">{offer.wave === 0 ? '开局' : `第 ${offer.wave} 波`}</span> · 选择一张牌
          {offer.cards.length > 1 && <span className="muted small">（{offer.cards.length} 选 1）</span>}
        </div>
        <div className="rogue-draw-cards">
          {offer.cards.map((id, i) => {
            const card = engine.rogueCards.get(id);
            if (!card) return null;
            const held = engine.held.find((h) => h.id === id);
            // 选择后的样子：新获得 / 升级进度 +1 / 升级
            const res = gainCard(engine.held, card);
            const badge = !held ? <span className="badge">新</span> : res.leveled ? <span className="badge badge-up">升级</span> : <span className="badge">进度 +1</span>;
            return (
              <RogueCardFace
                key={id}
                card={card}
                level={res.level}
                from={held && res.leveled ? held.level : undefined}
                copies={res.copies}
                badge={badge}
                hotkey={i < 9 ? String(i + 1) : undefined}
                onClick={() => onPick(id)}
              />
            );
          })}
        </div>
        <div className="rogue-draw-foot">
          <span className="muted small">
            持有 {engine.held.length}
            {cfg.maxHeld > 0 ? `/${cfg.maxHeld}` : ''} 种{full ? '（已满：只会抽到持有的牌）' : ''} · 再次选择持有的牌可以升级（等级没有上限）· 数字键选择
          </span>
          <button className="btn btn-s btn-ghost" onClick={() => onPick(null)} title="这次不要任何牌">
            跳过
          </button>
        </div>
      </div>
    </div>
  );
}

/** 肉鸽：持有的牌（点击 HUD 的「❖」打开） */
export function RogueHand({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const cfg = engine.rogue;
  if (!cfg) return null;
  const next = nextDrawWave(cfg, engine.wave);
  return (
    <div className="rogue-hand">
      <div className="row">
        <strong className="grow">
          持有的牌 {engine.held.length}
          {cfg.maxHeld > 0 ? `/${cfg.maxHeld}` : ''} 种
        </strong>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="muted small">
        {next != null ? `下一次抽牌：第 ${next} 波开始时` : '不会再抽牌'}
        {engine.skippedDraws > 0 ? ` · 已跳过 ${engine.skippedDraws} 次（牌组里没有可以抽到的牌）` : ''}
      </div>
      <div className="rogue-hand-list">
        {engine.held.map((h) => {
          const card = engine.rogueCards.get(h.id);
          return card ? <RogueCardFace key={h.id} card={card} level={h.level} copies={h.copies} compact /> : null;
        })}
        {!engine.held.length && <div className="muted small">还没有牌</div>}
      </div>
    </div>
  );
}

/** 选择之后的提示文字 */
export function pickMessage(engine: GameEngine): string | null {
  const p = engine.lastPick;
  const card = p ? engine.rogueCards.get(p.id) : undefined;
  if (!p || !card) return null;
  if (p.isNew) return `获得「${card.name}」`;
  if (p.leveled) return `「${card.name}」升到 Lv.${p.level}`;
  return `「${card.name}」升级进度 ${p.copies}/${Math.max(1, card.copies)}`;
}
