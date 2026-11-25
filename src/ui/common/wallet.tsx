import { formatCount, formatDrop, type LevelRewardInfo, type RolledRewards } from '../../core/leveling';
import type { CurrencyConfig, DropDisplay, ExpBookDef } from '../../core/types';
import { outlinedText } from '../../game/shapes';

/** 游戏外货币的数量，例如「◆ 1,250 金币」 */
export function CurrencyBadge({ name, color, amount, prefix = '' }: { name: string; color: string; amount: number; prefix?: string }) {
  return (
    <span className="currency-badge" style={outlinedText(color)} title={name}>
      <span className="currency-icon" style={{ background: color }} />
      {prefix}
      {formatCount(amount)} <small>{name}</small>
    </span>
  );
}

/** 经验书数量，例如「初级经验书 ×12」 */
export function BookChip({ book, count, prefix = '×' }: { book: ExpBookDef; count: number; prefix?: string }) {
  return (
    <span className="book-chip" style={{ borderColor: book.color }} title={`${book.name}：每本 +${book.exp} 经验，使用时消耗 ${book.cost}`}>
      <span className="book-icon" style={{ background: book.color }} />
      {book.name} {prefix}
      {formatCount(count)}
    </span>
  );
}

/** 玩家的货币和经验书库存 */
export function Wallet({ cfg, currency, books, showEmpty = false }: { cfg: CurrencyConfig; currency: number; books: Record<string, number>; showEmpty?: boolean }) {
  const owned = cfg.books.filter((b) => showEmpty || (books[b.id] ?? 0) > 0);
  return (
    <div className="wallet">
      <CurrencyBadge name={cfg.name} color={cfg.color} amount={currency} />
      {owned.map((b) => (
        <BookChip key={b.id} book={b} count={books[b.id] ?? 0} />
      ))}
    </div>
  );
}

/** 关卡的通关奖励（关卡选择中显示）：固定货币 + 经验书掉落（按「掉落显示」设置显示概率） */
export function RewardPreview({ cfg, info, display = cfg.dropDisplay }: { cfg: CurrencyConfig; info: LevelRewardInfo; display?: DropDisplay }) {
  const drops = display === 'hidden' ? [] : info.books;
  if (info.currency <= 0 && !drops.length) return null;
  return (
    <span className="reward-chips">
      {info.currency > 0 && <CurrencyBadge name={cfg.name} color={cfg.color} amount={info.currency} />}
      {drops.map((d, i) => {
        const b = cfg.books.find((x) => x.id === d.bookId)!;
        return (
          <span key={i} className="book-chip" style={{ borderColor: b.color }}>
            <span className="book-icon" style={{ background: b.color }} />
            {formatDrop(d, b, display)}
          </span>
        );
      })}
    </span>
  );
}

/** 这次通关实际获得的奖励 */
export function RewardList({ cfg, rewards }: { cfg: CurrencyConfig; rewards: RolledRewards }) {
  const books = cfg.books.filter((b) => (rewards.books[b.id] ?? 0) > 0);
  if (rewards.currency <= 0 && !books.length) return <span className="muted small">本关没有通关奖励</span>;
  return (
    <span className="reward-chips">
      {rewards.currency > 0 && <CurrencyBadge name={cfg.name} color={cfg.color} amount={rewards.currency} prefix="+" />}
      {books.map((b) => (
        <BookChip key={b.id} book={b} count={rewards.books[b.id]} />
      ))}
    </span>
  );
}
