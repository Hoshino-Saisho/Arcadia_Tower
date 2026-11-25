import { useEffect, useMemo, useState } from 'react';
import { normalizeEnemy, normalizeLevel } from '../../core/defaults';
import { loadDatabase, type GameDatabase } from '../../core/storage/repository';
import type { CharacterDef, GridPos } from '../../core/types';
import { preloadIcons } from '../../game/icons';
import { NumberInput } from '../common/fields';
import { Battle } from '../play/BattlePage';

/** 训练场地图：中间一条地面通道（敌人在上面来回移动），上下各两排高台 */
const GRID = ['HHHHHHHHHHHHH', 'HHHHHHHHHHHHH', 'GGGGGGGGGGGGG', 'HHHHHHHHHHHHH', 'HHHHHHHHHHHHH'];
const PATROL: GridPos[] = Array.from({ length: GRID[0].length }, (_, x) => ({ x, y: 2 }));
const TRIAL_LEVEL = normalizeLevel(
  {
    id: 'TRIAL_1',
    width: GRID[0].length,
    height: GRID.length,
    grid: GRID,
    settings: { name: '角色试用', initialHp: 99, initialMoney: 99999, autoMoney: true, moneyPerMinute: 6000, availableCharacters: [] },
    lines: [],
  },
  'TRIAL_1',
);
const DUMMY_ID = '__trial_dummy__';
const DUMMY = normalizeEnemy({ id: DUMMY_ID, name: '训练假人', color: '#9aa4b2', sides: 4, size: 1.1, maxHp: 10000, atk: 0, speed: 1, canAttack: false, reward: 0 });

/**
 * 角色试用：在训练场里试用正在编辑的角色（使用编辑中、还没保存的数值）。
 * 只有一个来回移动的敌人（可以换成任意敌人），试用的角色一开始就在场上，也可以撤退或再部署其他角色；
 * 可以刷新敌人的血量、让敌人停止移动，上方显示伤害 / 治疗统计。
 */
export function CharacterTrial({ characters, focusId, onClose }: { characters: CharacterDef[]; focusId: string; onClose: () => void }) {
  const [db, setDb] = useState<GameDatabase | null>(null);
  const [error, setError] = useState('');
  const [enemyId, setEnemyId] = useState(DUMMY_ID);
  const [level, setLevel] = useState(1);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    loadDatabase().then(setDb, (e) => setError(String(e)));
  }, []);

  // 试用的角色排在第一个；ID 重复的只保留一个
  const roster = useMemo(() => {
    const focus = characters.find((c) => c.id === focusId);
    const list = focus ? [focus, ...characters.filter((c) => c !== focus)] : characters;
    return list.filter((c, i) => list.findIndex((x) => x.id === c.id) === i);
  }, [characters, focusId]);

  const trialDb = useMemo(() => (db ? { ...db, characters: roster, enemies: [DUMMY, ...db.enemies.filter((e) => e.id !== DUMMY_ID)] } : null), [db, roster]);
  useEffect(() => {
    if (trialDb) preloadIcons([...trialDb.characters.map((c) => c.icon), ...trialDb.enemies.map((e) => e.icon)]);
  }, [trialDb]);

  // Esc 不关闭（战斗里 Esc 用来取消选择），用左上角的「退出试用」
  const body = !trialDb ? (
    <div className="page-msg">
      {error ? `读取数据失败：${error}` : '加载中…'}
      <button className="btn" onClick={onClose}>
        关闭
      </button>
    </div>
  ) : (
    <Battle
      key={`${enemyId}:${level}:${attempt}`}
      db={trialDb}
      level={TRIAL_LEVEL}
      test={false}
      onRestart={() => setAttempt((a) => a + 1)}
      training={{
        focusId,
        enemyId,
        path: PATROL,
        level,
        onExit: onClose,
        controls: (
          <>
            <label className="trial-control" title="换一个敌人（会重新开始试用）">
              <span>敌人</span>
              <select className="input" value={enemyId} onChange={(e) => setEnemyId(e.target.value)}>
                <option value={DUMMY_ID}>训练假人（不攻击）</option>
                {trialDb.enemies
                  .filter((e) => e.id !== DUMMY_ID)
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}（{e.id}）
                    </option>
                  ))}
              </select>
            </label>
            <label className="trial-control" title="全部角色的等级（会重新开始试用）">
              <span>等级</span>
              <NumberInput value={level} min={1} max={trialDb.currency.maxLevel} integer width={64} onChange={setLevel} />
            </label>
            <button className="btn btn-s btn-ghost" onClick={() => setAttempt((a) => a + 1)} title="重新开始试用">
              ↺ 重新开始
            </button>
          </>
        ),
      }}
    />
  );
  return <div className="trial-overlay">{body}</div>;
}
