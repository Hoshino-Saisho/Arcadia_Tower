/**
 * 无界面测试：npm test
 *  1. 寻路 / 手动路线校验
 *  2. 数据校验（路线、引用的敌人 / 技能 ID）
 *  3. 解锁规则
 *  4. 战斗机制：物伤 / 法伤、治疗、多目标、技能 SP 与释放、增益减益、生命上限同步、金钱技能、角色技能设定、
 *     停留点、转圈路线、部署冷却、角色等级
 *  5. 用简单的自动部署策略把每个关卡模拟打一遍
 *  6. 手机版舞台的坐标换算（缩放 / 旋转 90°）
 *  7. 升级与通关奖励：升级经验表、经验书、升级成长、掉落（基础奖励 × 关卡倍数）
 *  8. 负数数值：负数物抗 / 法抗、负数成长、负数费用 / 击杀奖励 / 金钱回复
 *  9. 无尽模式：难度、出现位列、波次、敌人强化、分数和兑换
 * 10. 角色试用（训练场）：敌人来回移动、停止移动、刷新血量、重新出现、伤害统计
 * 11. 持续治疗 / 持续伤害
 * 12. 召唤物：出现在部署栏、继承数值、部署范围、离场、无敌、召唤者自身攻击
 * 13. 编队：最多 12 个、顺序、和关卡可用角色的组合
 * 14. 敌人的召唤物：召唤节奏、同时存在上限、继承、沿路线前进、进入基地、击败奖励、随召唤者消失、无敌、阵营限制
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  isSummonDef,
  newEndlessConfig,
  normalizeCharacter,
  normalizeChapter,
  normalizeCurrency,
  normalizeEndless,
  normalizeEnemy,
  normalizeLevel,
  normalizeProgress,
  normalizeSkill,
  normalizeSummon,
  resolveLoadout,
} from '../src/core/defaults';
import {
  addExp,
  applyBooks,
  expTable,
  grantRewards,
  leveledCharacter,
  levelMap,
  dropCountText,
  endlessRewards,
  levelRewardInfo,
  rollRewards,
  usefulBooks,
} from '../src/core/leveling';
import { describeAttack } from '../src/core/describe';
import { checkManualPath, findPath, resolveRoute, resolveWaits, visitNumbers } from '../src/core/pathfinding';
import { eligibleEnemies, firstWaveOf, groupSize, planWave, seededRng, waveGroupCount } from '../src/core/endless';
import { battleRoster, resolveSquad } from '../src/core/squad';
import { ProgressView } from '../src/core/progress';
import { rangeOffsets, tileInRange } from '../src/core/range';
import { applyModifiers, computeDamage } from '../src/core/stats';
import { TileGrid } from '../src/core/tiles';
import type { CharacterDef, EnemyDef, GridPos, LevelDef, SkillDef } from '../src/core/types';
import { FIXED_DT, GameEngine } from '../src/game/engine';
import { STAGE_H, STAGE_W, clientToStage, needsStage, stage } from '../src/ui/common/stage';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataDir = process.env.ARCADIA_DATA_DIR ?? path.join(root, 'data');
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8'));

let failures = 0;
let warnings = 0;
function check(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}
/** 不算失败的提醒（例如关卡数值偏难，简单的自动部署策略打不过） */
function warn(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    warnings++;
    console.log(`  ⚠ ${msg}`);
  }
}

const characters: CharacterDef[] = readJson('characters.json').characters.map(normalizeCharacter);
const enemies: EnemyDef[] = readJson('enemies.json').enemies.map(normalizeEnemy);
const skills: SkillDef[] = readJson('skills.json').skills.map(normalizeSkill);
const chapters = readJson('chapters.json').chapters.map(normalizeChapter);
const levelFiles = fs.readdirSync(path.join(dataDir, 'levels')).filter((f) => f.endsWith('.json'));
const levels: LevelDef[] = levelFiles.map((f) => normalizeLevel(readJson(`levels/${f}`), f.slice(0, -5)));
const currency = normalizeCurrency(fs.existsSync(path.join(dataDir, 'currency.json')) ? readJson('currency.json') : null);
const endlessCfg = normalizeEndless(fs.existsSync(path.join(dataDir, 'endless.json')) ? readJson('endless.json') : null);
const charById = new Map(characters.map((c) => [c.id, c]));
const enemyById = new Map(enemies.map((e) => [e.id, e]));

console.log('\n[1] 寻路单元测试');
{
  const g = new TileGrid(5, 3, ['SGGGB', 'HHGHH', '..G..']);
  const p = findPath(g, { x: 0, y: 0 }, null);
  check(p && p.length === 5 && p[4].x === 4, `直线寻路 长度=${p?.length}`);
  const g2 = new TileGrid(5, 3, ['SGHGB', 'HGHGH', '.GGG.']);
  const p2 = findPath(g2, { x: 0, y: 0 }, null);
  check(p2 && p2.length === 9, `绕行寻路 长度=${p2?.length}`);
  check(findPath(new TileGrid(3, 1, ['SHB']), { x: 0, y: 0 }, null) === null, '被高台阻断时寻路失败');
  const ok = checkManualPath(g2, p2!);
  check(ok.ok && ok.complete, '自动路线可以通过手动路线校验');
  check(!checkManualPath(g2, [{ x: 0, y: 0 }, { x: 2, y: 0 }]).ok, '不相连的手动路线会报错');
  check(findPath(new TileGrid(5, 1, ['SGBGB']), { x: 0, y: 0 }, { x: 4, y: 0 }) === null, '指定远处基地时不会穿过近处的基地');

  // 转圈：手动路线可以重复经过同一个方块
  const ring = new TileGrid(4, 2, ['SGGB', '.GG.']);
  const loop = [
    [0, 0], [1, 0], [1, 1], [2, 1], [2, 0], [1, 0], [1, 1], [2, 1], [2, 0], [3, 0],
  ].map(([x, y]) => ({ x, y }));
  const lc = checkManualPath(ring, loop);
  check(lc.ok && lc.complete, '转圈的手动路线（重复经过 4 个方块）可以通过校验');
  check(visitNumbers(loop).join('') === '1111122221', `第几次经过：${visitNumbers(loop).join('')}`);
  const rw = resolveWaits(loop, [
    { x: 1, y: 0, visit: 2, duration: 2 },
    { x: 2, y: 1, visit: 1, duration: 1.5 },
    { x: 3, y: 0, visit: 1, duration: 9 },
    { x: 1, y: 0, visit: 3, duration: 4 },
  ]);
  check(rw.perStep[5] === 2 && rw.perStep[3] === 1.5 && rw.total === 3.5, '停留点按「第几次经过」换算到路线上的对应一格');
  check(rw.invalid.length === 2, '设在终点基地上 / 第 3 次经过（不存在）的停留点无效');
}

console.log('\n[2] 数据校验');
check(characters.length > 0 && enemies.length > 0 && skills.length > 0, `角色 ${characters.length} · 敌人 ${enemies.length} · 技能 ${skills.length}`);
const skillIds = new Set(skills.map((s) => s.id));
for (const d of [...characters, ...enemies]) {
  const missing = d.skills.filter((id) => !skillIds.has(id));
  if (missing.length) check(false, `${d.id} 引用了不存在的技能 ${missing.join(',')}`);
}
check(true, '角色 / 敌人引用的技能都存在');
for (const lv of levels) {
  const grid = TileGrid.fromLevel(lv);
  for (const line of lv.lines) {
    const r = resolveRoute(grid, line.route);
    check(!!r.path, `${lv.id}「${line.name}」路线有效（${r.path?.length ?? 0} 格）${r.error ? ' ' + r.error : ''}`);
    if (r.waits?.invalid.length) warn(false, `${lv.id}「${line.name}」有 ${r.waits.invalid.length} 个停留点不在路线上`);
    for (const b of line.blocks) if (!enemyById.has(b.enemyId)) check(false, `${lv.id} 敌人 ${b.enemyId} 不存在`);
  }
}
check(currency.books.length > 0 && currency.maxLevel >= 1, `货币设置：${currency.name}，经验书 ${currency.books.length} 种，等级上限 ${currency.maxLevel}`);
check(
  currency.defaultBooks.every((d) => currency.books.some((b) => b.id === d.bookId)),
  '基础通关掉落引用的经验书都存在',
);
{
  const g = TileGrid.fromLevel(endlessCfg.map);
  const valid = endlessCfg.map.lines.filter((l) => resolveRoute(g, l.route).path).length;
  if (endlessCfg.enabled) check(valid > 0, `无尽模式已启用：地图有 ${valid} 条有效路线`);
  check(endlessCfg.bookRates.every((r) => currency.books.some((b) => b.id === r.bookId)), '无尽模式兑换引用的经验书都存在');
}

console.log('\n[3] 进度解锁规则');
{
  const built = new Set(levels.map((l) => l.id));
  const v0 = new ProgressView(chapters, normalizeProgress({}), built);
  check(v0.isChapterUnlocked(0) && !v0.isChapterUnlocked(1), '初始只解锁第一章');
  check(v0.isLevelUnlocked('ZH', 1) && !v0.isLevelUnlocked('ZH', 2), '初始只解锁 ZH_1');
  const v1 = new ProgressView(chapters, normalizeProgress({ cleared: ['ZH_1', 'ZH_2', 'ZH_3'] }), built);
  check(v1.isChapterUnlocked(1) && v1.isLevelUnlocked('EX', 1) && !v1.isLevelUnlocked('EX', 2), '第一章通关后解锁 EX_1，EX_2 仍锁定');
}

console.log('\n[4] 战斗机制');
{
  check(computeDamage(100, 'physical', 40, 90) === 60, '物伤：100 攻击 − 40 物抗 = 60（无视法抗）');
  check(computeDamage(100, 'magic', 999, 30) === 70, '法伤：100 攻击 × (1 − 30% 法抗) = 70（无视物抗）');
  check(computeDamage(100, 'physical', 500, 0) === 5, '伤害至少为攻击力的 5%');
  check(computeDamage(100, 'true', 500, 90) === 100, '真伤无视物抗和法抗');
  check(rangeOffsets(1).length === 5 && rangeOffsets(1.5).length === 9 && rangeOffsets(2).length === 13, '射程按方块：1 = 十字 5 格，1.5 = 3×3，2 = 13 格');
  check(!tileInRange({ x: 0, y: 0 }, { x: 1, y: 1 }, 1) && tileInRange({ x: 0, y: 0 }, { x: 1, y: 1 }, 1.5), '射程 1 打不到斜角方块，1.5 可以');
  const base = { maxHp: 1000, atk: 100, def: 100, res: 30, attackInterval: 1, range: 1, targetCount: 1, blockCount: 1, speed: 1, hpRegen: 0 };
  const mod = applyModifiers(base, [[{ stat: 'def', mode: 'add', value: -40 }, { stat: 'res', mode: 'add', value: -20 }, { stat: 'atk', mode: 'percent', value: 50 }]]);
  check(mod.def === 60 && mod.res === 10 && mod.atk === 150, '同一个效果可以同时降低物抗 / 法抗并提升攻击力');
  check(applyModifiers({ ...base, targetCount: -1 }, [[{ stat: 'targetCount', mode: 'add', value: 2 }]]).targetCount === -1, '目标数 -1（全部）不受修改影响');

  // 用一个小地图做受控实验：S G G G G B，角色放在高台上
  const lv = normalizeLevel({
    id: 'T_1',
    width: 6,
    height: 2,
    grid: ['SGGGGB', 'HHHHHH'],
    settings: { initialHp: 99, initialMoney: 999, autoMoney: false },
    lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [] }],
  });
  const dummy: EnemyDef = { ...normalizeEnemy({ id: 'D', maxHp: 100000, speed: 0.05, canAttack: false }) };
  const runSkills = (eng: GameEngine, sec: number) => {
    for (let t = 0; t < sec; t += FIXED_DT) eng.step(FIXED_DT);
  };

  // 治疗：医疗角色发射治疗子弹，治疗受伤的队友（场上放一个不攻击的敌人，避免战斗立即结束）
  const medic = charById.get('C006')!;
  const guard = charById.get('C001')!;
  const lvHeal = normalizeLevel({ ...lv, lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [{ id: 'b', enemyId: 'D', count: 1, interval: 1, startTime: 0 }] }] });
  const eng = new GameEngine(lvHeal, [medic, guard], [dummy], { skills });
  eng.deploy('C006', { x: 2, y: 1 });
  eng.deploy('C001', { x: 2, y: 0 });
  const g0 = eng.units.find((u) => u.def.id === 'C001')!;
  g0.hp = 300;
  runSkills(eng, 1);
  check(g0.hp > 300, `医疗（攻击力 ${medic.atk}，攻击队友）治疗了受伤的守卫：300 → ${Math.round(g0.hp)}`);
  if (medic.onHit) check(g0.statuses.some((st) => st.key.startsWith('onhit:C006')), '治疗时附带的效果作用在被治疗的队友身上');

  // 多目标：目标数 -1 攻击射程内全部敌人
  // 用测试专用的角色（不依赖 data/ 里的数值，数据改了也不影响测试）
  const gunner = normalizeCharacter({
    id: 'C007',
    name: '炮手',
    placement: 'high',
    cost: 0,
    atk: 60,
    range: 1.5,
    attackType: 'area',
    onHit: { modifiers: [{ stat: 'speed', mode: 'percent', value: -40 }], duration: 2 },
  });
  const lv2 = normalizeLevel({ ...lv, lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [{ id: 'b', enemyId: 'D', count: 3, interval: 0.4, startTime: 0 }] }] });
  const eng2 = new GameEngine(lv2, [gunner], [dummy], { skills });
  runSkills(eng2, 1.2);
  eng2.deploy('C007', { x: 1, y: 1 });
  runSkills(eng2, 0.5);
  const hits = eng2.enemies.filter((e) => e.hp < e.stats.maxHp).length;
  check(hits === 3 && eng2.projectiles.length === 0, `炮手（范围伤害）不发射子弹，同时命中了射程内全部 ${hits} 个敌人`);
  check(eng2.enemies.every((e) => e.stats.speed < e.base.speed), '命中附带的减速效果生效');

  // 默认攻击 = 发射子弹；真伤无视物抗和法抗
  const judge = charById.get('C008')!;
  const tank = normalizeEnemy({ id: 'T', maxHp: 100000, speed: 0.05, canAttack: false, def: 5000, res: 100 });
  const lv3 = normalizeLevel({ ...lv, lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [{ id: 'b', enemyId: 'T', count: 1, interval: 1, startTime: 0 }] }] });
  const eng5 = new GameEngine(lv3, [judge], [tank], { skills: [] });
  runSkills(eng5, 0.1);
  eng5.deploy('C008', { x: 1, y: 0 });
  eng5.step(FIXED_DT);
  check(eng5.projectiles.length === 1, '默认攻击发射子弹（命中前不结算伤害）');
  runSkills(eng5, 0.3);
  const lost = tank.maxHp - eng5.enemies[0].hp;
  check(Math.abs(lost - judge.atk) < 1e-6, `真伤：对物抗 5000 / 法抗 100% 的敌人仍造成全额 ${lost} 伤害`);

  // 技能：攻击积累 SP → 自动释放；自动积累 SP → 手动释放
  const archer = charById.get('C002')!;
  const eng3 = new GameEngine(lv2, [archer], [dummy], { skills, loadouts: { C002: ['S004'] } });
  runSkills(eng3, 1.2);
  eng3.deploy('C002', { x: 2, y: 1 });
  const a = eng3.units[0];
  check(a.skills.length === 1 && a.skills[0].def.id === 'S004', '角色设定生效：射手携带「破甲箭」而不是默认的「连射」');
  runSkills(eng3, 5 * archer.attackInterval + 0.2);
  check(eng3.enemies.some((e) => e.statuses.some((s) => s.name === '破甲箭')), '攻击 5 次后自动释放「破甲箭」，目标获得物抗减益');
  const eng4 = new GameEngine(lv2, [archer], [dummy], { skills });
  eng4.deploy('C002', { x: 2, y: 1 });
  const b = eng4.units[0];
  check(eng4.activateSkill(b.uid, 0) === 'SP 不足', 'SP 不足时不能手动释放');
  runSkills(eng4, 16);
  check(b.skills[0].sp >= b.skills[0].def.spMax && !b.skills[0].active, '手动技能 SP 满后不会自动释放，等待玩家点击');
  check(eng4.activateSkill(b.uid, 0) === null && b.skills[0].active, '手动释放「连射」成功');
  runSkills(eng4, 0.1);
  check(b.stats.targetCount === 2 && b.stats.attackInterval < archer.attackInterval, '技能持续期间：目标数 +1、攻击间隔缩短');
  runSkills(eng4, 10);
  check(!b.skills[0].active && b.stats.targetCount === 1, '技能结束后属性恢复');
  check(resolveLoadout({ skills: ['A', 'B', 'C'], skillSlots: 1 }, ['C']).join() === 'C', '只能带 1 个技能的角色可以在 3 个技能中选择 1 个');
  check(resolveLoadout({ skills: ['A', 'B', 'C'], skillSlots: 2 }, ['X']).join() === 'A,B', '无效的设定会回到默认技能');

  // 生命上限变化时，当前生命同步增加 / 减少同样的数值
  {
    const tester = normalizeCharacter({ id: 'HP', name: '测试', maxHp: 100, atk: 0, placement: 'high', cost: 0, range: 0 });
    const engH = new GameEngine(lvHeal, [tester], [dummy], { skills: [] });
    engH.deploy('HP', { x: 3, y: 1 });
    const u = engH.units[0];
    u.hp = 40;
    const st = (key: string, stat: 'maxHp', mode: 'add' | 'percent', value: number, duration = 1) =>
      engH.addStatus(u, { key, name: key, color: '#ffffff', modifiers: [{ stat, mode, value }], duration });
    st('a', 'maxHp', 'percent', 20);
    check(u.stats.maxHp === 120 && Math.abs(u.hp - 60) < 1e-6, `生命上限 +20%：100 上限 / 40 生命 → ${u.stats.maxHp} / ${u.hp}`);
    runSkills(engH, 1.2);
    check(u.stats.maxHp === 100 && Math.abs(u.hp - 60) < 1e-6, `效果结束后生命不减少（不超过上限）：120 / 60 → ${u.stats.maxHp} / ${Math.round(u.hp)}`);
    u.hp = 40;
    st('b', 'maxHp', 'add', -30);
    check(u.stats.maxHp === 70 && Math.abs(u.hp - 10) < 1e-6, `生命上限 −30（固定值）：100 / 40 → ${u.stats.maxHp} / ${u.hp}`);
    st('c', 'maxHp', 'add', -50);
    check(u.stats.maxHp === 20 && u.hp === 1, `上限降低不会直接致死（最少保留 1 点）：→ ${u.stats.maxHp} / ${u.hp}`);
    u.hp = u.stats.maxHp;
    st('d', 'maxHp', 'add', 50);
    check(u.stats.maxHp === 70 && u.hp === 70, '满血时提高上限，生命同样增加（仍然满血）');
    runSkills(engH, 1.2);
    check(u.stats.maxHp === 100 && u.hp === 70, `全部效果结束：上限回到 ${u.stats.maxHp}，生命保持 ${u.hp}（减少上限的效果结束时也不改变生命）`);
    st('e', 'maxHp', 'percent', 50);
    u.hp = 150;
    runSkills(engH, 1.2);
    check(u.stats.maxHp === 100 && u.hp === 100, '效果结束时生命超过新的上限 → 降到上限');
  }

  // 金钱技能：立即获得 + 持续期间每秒获得；敌人释放时玩家失去金钱；施放者离场后停止
  {
    const moneySkill = normalizeSkill({ id: 'SM', name: '募集', spMax: 1, spInitial: 1, spGain: 'auto', spRate: 0, trigger: 'manual', duration: 5, effects: [{ kind: 'money', money: 10, moneyRate: 2 }] });
    check(moneySkill.effects[0].kind === 'money' && moneySkill.effects[0].money === 10 && moneySkill.effects[0].moneyRate === 2, '金钱效果可以保存 / 读取');
    const banker = normalizeCharacter({ id: 'MB', name: '商人', placement: 'high', cost: 0, atk: 0, range: 0, skills: ['SM'], skillSlots: 1 });
    const poorLevel = normalizeLevel({ ...lvHeal, settings: { initialHp: 99, initialMoney: 0, autoMoney: false } });
    const engM = new GameEngine(poorLevel, [banker], [dummy], { skills: [moneySkill] });
    engM.deploy('MB', { x: 3, y: 1 });
    check(engM.activateSkill(engM.units[0].uid, 0) === null && engM.money === 10, '释放时立即获得 10 金钱');
    runSkills(engM, 6);
    check(Math.abs(engM.money - 20) < 0.01, `持续 5 秒、每秒 +2：共 ${engM.money.toFixed(2)}（10 + 10）`);

    const engR = new GameEngine(poorLevel, [banker], [dummy], { skills: [moneySkill] });
    engR.deploy('MB', { x: 3, y: 1 });
    engR.activateSkill(engR.units[0].uid, 0);
    runSkills(engR, 1);
    engR.retreat(engR.units[0].uid);
    const afterRetreat = engR.money;
    runSkills(engR, 3);
    check(Math.abs(afterRetreat - 12) < 0.05 && engR.money === afterRetreat, `施放者撤退后持续金钱停止（${afterRetreat.toFixed(2)} → ${engR.money.toFixed(2)}）`);

    const thief = normalizeEnemy({ id: 'TH', name: '小偷', maxHp: 100000, speed: 0.05, canAttack: false, skills: ['SM'], skillSlots: 1 });
    const thiefLevel = normalizeLevel({
      ...lv,
      settings: { initialHp: 99, initialMoney: 50, autoMoney: false },
      lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [{ id: 'b', enemyId: 'TH', count: 1, interval: 1, startTime: 0 }] }],
    });
    const engT = new GameEngine(thiefLevel, [], [thief], { skills: [moneySkill] });
    engT.step(FIXED_DT);
    check(engT.money <= 40 && engT.money > 39.9, `敌人释放金钱技能：玩家失去 10 金钱（50 → ${engT.money.toFixed(2)}）`);
    runSkills(engT, 6);
    check(Math.abs(engT.money - 30) < 0.01, `敌人的每秒金钱 = 玩家每秒失去：→ ${engT.money.toFixed(2)}`);
  }

  // 停留点：敌人走到 (2,0) 停留 3 秒再继续（速度 1 格/秒，不停留时 5 秒到达基地）
  {
    const walker = normalizeEnemy({ id: 'W', maxHp: 100000, speed: 1, canAttack: false });
    const lvW = normalizeLevel({
      ...lv,
      lines: [
        {
          id: 'L',
          name: 't',
          route: { mode: 'auto', spawn: { x: 0, y: 0 }, waits: [{ x: 2, y: 0, visit: 1, duration: 3 }] },
          blocks: [{ id: 'b', enemyId: 'W', count: 1, interval: 1, startTime: 0 }],
        },
      ],
    });
    const engW = new GameEngine(lvW, [], [walker], { skills: [] });
    runSkills(engW, 2.5);
    const e = engW.enemies[0];
    check(e && Math.abs(e.x - 2.5) < 1e-6 && e.waitLeft > 0, `2.5 秒时敌人停在停留点 (2,0) 的中心（x = ${e?.x.toFixed(2)}，还要停 ${e?.waitLeft.toFixed(2)} 秒）`);
    runSkills(engW, 2.3);
    check(Math.abs(e.x - 2.5) < 1e-6, '停留期间不移动');
    runSkills(engW, 0.6);
    check(e.x > 2.5 && e.waitLeft === 0, `停留 3 秒后继续前进（x = ${e.x.toFixed(2)}）`);
    runSkills(engW, 2.4);
    check(engW.leaked === 0, '8 秒前还没有到达基地');
    runSkills(engW, 0.3);
    check(engW.leaked === 1, `走完路线 + 停留共约 8 秒后到达基地（${engW.time.toFixed(2)} 秒）`);
  }

  // 转圈路线：重复经过同一个方块；第 2 次经过 (1,0) 时停留 2 秒（9 格路程 + 2 秒 = 11 秒）
  {
    const walker = normalizeEnemy({ id: 'W', maxHp: 100000, speed: 1, canAttack: false });
    const loopPath = [
      [0, 0], [1, 0], [1, 1], [2, 1], [2, 0], [1, 0], [1, 1], [2, 1], [2, 0], [3, 0],
    ].map(([x, y]) => ({ x, y }));
    const lvL = normalizeLevel({
      id: 'T_2',
      width: 4,
      height: 3,
      grid: ['SGGB', 'HGGH', 'HHHH'],
      settings: { initialHp: 99, initialMoney: 0, autoMoney: false },
      lines: [
        {
          id: 'L',
          name: '转圈',
          route: { mode: 'manual', spawn: { x: 0, y: 0 }, path: loopPath, waits: [{ x: 1, y: 0, visit: 2, duration: 2 }] },
          blocks: [{ id: 'b', enemyId: 'W', count: 1, interval: 1, startTime: 0 }],
        },
      ],
    });
    const engL = new GameEngine(lvL, [], [walker], { skills: [] });
    check(engL.warnings.length === 0 && engL.routes[0].path.length === 10, '转圈路线可以在战斗中使用');
    runSkills(engL, 1.05);
    check(engL.enemies[0].waitLeft === 0, '第 1 次经过 (1,0) 不停留');
    runSkills(engL, 5);
    const e = engL.enemies[0];
    check(Math.abs(e.x - 1.5) < 1e-6 && Math.abs(e.y - 0.5) < 1e-6 && e.waitLeft > 0, '第 2 次经过 (1,0) 时停留');
    runSkills(engL, 4.8);
    check(engL.leaked === 0, '10.9 秒时还没有到达基地');
    runSkills(engL, 0.3);
    check(engL.leaked === 1, `转圈 + 停留共约 11 秒后到达基地（${engL.time.toFixed(2)} 秒）`);
  }

  // 部署冷却：部署后 5 秒内不能再部署同一个角色（其他角色不受影响）
  {
    const cd = normalizeCharacter({ id: 'CD', name: '冷却', placement: 'high', cost: 0, atk: 0, range: 0, deployCooldown: 5 });
    const other = normalizeCharacter({ id: 'OT', name: '其他', placement: 'high', cost: 0, atk: 0, range: 0 });
    const engC = new GameEngine(lvHeal, [cd, other], [dummy], { skills: [] });
    check(engC.deploy('CD', { x: 0, y: 1 }) === null, '第一次部署成功');
    const err = engC.deploy('CD', { x: 1, y: 1 });
    check(!!err && err.includes('冷却'), `冷却中不能再次部署：${err}`);
    check(engC.deploy('OT', { x: 2, y: 1 }) === null, '冷却只限同一个角色，其他角色可以部署');
    runSkills(engC, 4.9);
    check(!engC.cardState(cd).ok && engC.cardState(cd).cooldown > 0, `4.9 秒时仍在冷却（剩余 ${engC.cardState(cd).cooldown.toFixed(2)} 秒）`);
    runSkills(engC, 0.2);
    check(engC.deploy('CD', { x: 1, y: 1 }) === null, '冷却结束后可以再次部署');
  }

  // 角色等级：基础数值 + 升级成长 × (等级 − 1)
  {
    const g = normalizeCharacter({ id: 'LV', name: '升级', placement: 'high', cost: 0, maxHp: 1000, atk: 100, def: 50, res: 10, range: 0, growth: { maxHp: 50, atk: 5, def: 3, res: 1 } });
    const engLv = new GameEngine(lvHeal, [g], [dummy], { skills: [], levels: { LV: 5 } });
    const d = engLv.roster[0];
    check(d.maxHp === 1200 && d.atk === 120 && d.def === 62 && d.res === 14, `5 级角色的数值：生命 ${d.maxHp} · 攻击 ${d.atk} · 物抗 ${d.def} · 法抗 ${d.res}`);
    engLv.deploy('LV', { x: 0, y: 1 });
    check(engLv.units[0].level === 5 && engLv.units[0].hp === 1200, '部署后的角色是 5 级，满血 1200');
  }
}

/* ---------- 自动部署策略 ---------- */
function coverage(eng: GameEngine, tile: GridPos, range: number): number {
  let n = 0;
  for (const r of eng.routes) for (const p of r.path) if (Math.hypot(p.x - tile.x, p.y - tile.y) <= range) n++;
  return n;
}

function bestTile(eng: GameEngine, def: CharacterDef): GridPos | null {
  let best: GridPos | null = null;
  let bestScore = 0;
  for (let y = 0; y < eng.grid.height; y++) {
    for (let x = 0; x < eng.grid.width; x++) {
      const tile = { x, y };
      if (eng.checkDeploy(def, tile)) continue;
      let score: number;
      if (def.placement === 'ground' && def.blockCount > 0) {
        score = 0;
        for (const r of eng.routes) {
          const i = r.path.findIndex((p) => p.x === x && p.y === y);
          if (i >= 0) score = Math.max(score, i / r.path.length + 1);
        }
        if (score && eng.units.some((u) => u.canBlock && Math.abs(u.tile.x - x) + Math.abs(u.tile.y - y) <= 1)) score *= 0.5;
      } else if (def.attackTarget === 'ally') {
        score = eng.units.filter((u) => Math.hypot(u.tile.x - x, u.tile.y - y) <= def.range).length + 0.1;
      } else {
        score = coverage(eng, tile, def.range);
      }
      if (score > bestScore) {
        bestScore = score;
        best = tile;
      }
    }
  }
  return best;
}

function simulate(level: LevelDef, strategy: 'none' | 'auto') {
  const eng = new GameEngine(level, characters, enemies, { skills });
  const order = ['C001', 'C002', 'C002', 'C003', 'C006', 'C001', 'C002', 'C004', 'C003', 'C007', 'C002', 'C005', 'C003', 'C002'];
  let next = 0;
  let t = 0;
  while (eng.status === 'running' && eng.time < 900) {
    if (strategy === 'auto') {
      if (t <= 0 && next < order.length) {
        const def = eng.roster.find((c) => c.id === order[next]);
        if (!def) next++;
        else if (eng.cardState(def).ok) {
          const tile = bestTile(eng, def);
          if (!tile || !eng.deploy(def.id, tile)) next++;
        }
        t = 0.25;
      }
      // 手动技能：SP 满就放
      for (const u of eng.units) u.skills.forEach((s, i) => s.sp >= s.def.spMax && !s.active && eng.activateSkill(u.uid, i));
    }
    eng.step(FIXED_DT);
    t -= FIXED_DT;
  }
  return eng;
}

console.log('\n[5] 关卡模拟');
for (const lv of levels) {
  const idle = simulate(lv, 'none');
  check(idle.status === 'lost' || idle.leaked === idle.totalEnemies, `${lv.id} 不部署任何角色：${idle.status}，漏怪 ${idle.leaked}/${idle.totalEnemies}`);
  const auto = simulate(lv, 'auto');
  const used = auto.units.map((u) => u.def.name).join('、');
  // 战斗能正常进行（有击杀）是硬性要求；能不能打赢取决于关卡数值，只做提醒
  check(auto.killed > 0 || auto.totalEnemies === 0, `${lv.id} 自动部署时角色能正常击杀敌人（击杀 ${auto.killed}）`);
  warn(
    auto.status === 'won',
    `${lv.id} 自动部署：${auto.status}，用时 ${auto.time.toFixed(1)}s，击杀 ${auto.killed}，漏怪 ${auto.leaked}，剩余血量 ${auto.hp}/${auto.maxHp}，场上：${used || '无'}` +
      (auto.status === 'won' ? '' : '（简单的自动部署策略没打赢：关卡可能偏难，需要时调整数值）'),
  );
  if (auto.warnings.length) console.log('    警告：', auto.warnings.join('；'));
}

console.log('\n[6] 手机版舞台：屏幕坐标换算');
{
  // 用和 GameStage 相同的公式算出变换，再检查「设计坐标 → 屏幕 → 设计坐标」能还原
  const vw = 375;
  const vh = 812;
  const sc = Math.min(vw / STAGE_H, vh / STAGE_W);
  Object.assign(stage, { active: true, rotated: true, s: sc, ox: (vw - STAGE_H * sc) / 2 + STAGE_H * sc, oy: (vh - STAGE_W * sc) / 2 });
  const toScreen = (x: number, y: number) => ({ x: stage.ox - y * stage.s, y: stage.oy + x * stage.s });
  const pts = [
    [0, 0],
    [STAGE_W, STAGE_H],
    [123, 456],
  ];
  const okRot = pts.every(([x, y]) => {
    const p = clientToStage(toScreen(x, y).x, toScreen(x, y).y);
    return Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6;
  });
  const corners = [toScreen(0, 0), toScreen(STAGE_W, STAGE_H)];
  const inside = corners.every((c) => c.x >= -1e-6 && c.x <= vw + 1e-6 && c.y >= -1e-6 && c.y <= vh + 1e-6);
  check(okRot && inside, `竖屏强制横屏（旋转 90°，缩放 ${sc.toFixed(3)}）：坐标可以还原，画面在屏幕内`);
  Object.assign(stage, { rotated: false, s: 0.5, ox: 10, oy: 20 });
  const p = clientToStage(10 + 100 * 0.5, 20 + 50 * 0.5);
  check(Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y - 50) < 1e-6, '不旋转时的等比缩放坐标换算');
  check(needsStage(375, 812) && needsStage(812, 375) && !needsStage(1280, 800), '手机（竖屏 / 横屏）使用舞台缩放，电脑窗口不使用');
  Object.assign(stage, { active: false, rotated: false, s: 1, ox: 0, oy: 0 });
}

console.log('\n[7] 升级与通关奖励');
{
  const cfg = normalizeCurrency({ name: '金币', baseExp: 100, expGrowth: 0.75, maxLevel: 20, books: [{ id: 'B1', name: '初级', exp: 100, cost: 10 }, { id: 'B2', name: '中级', exp: 300, cost: 30 }] });
  const t = expTable(cfg);
  check(t.slice(1, 6).join(',') === '100,175,306,536,938', `升级经验：每一级 = 上一级 × 1.75（${t.slice(1, 6).join(' → ')}）`);
  check(t.length === 20, '等级上限 20：共 19 次升级');
  const a = addExp(cfg, { level: 1, exp: 0 }, 300);
  check(a.result.level === 3 && a.result.exp === 25 && a.levels === 2, `+300 经验：1 级 → ${a.result.level} 级，剩余 ${a.result.exp}`);
  const capped = addExp({ ...cfg, maxLevel: 3 }, { level: 1, exp: 0 }, 1000);
  check(capped.result.level === 3 && capped.result.exp === 0 && capped.wasted === 725, `满级后多出来的经验作废（浪费 ${capped.wasted}）`);

  const poor = normalizeProgress({ currency: 25, books: { B1: 3 } });
  const r1 = applyBooks(cfg, poor, 'C001', 'B1', 3);
  check(!r1.ok && r1.error.includes('金币不足'), `货币不够时不能使用：${r1.ok ? '' : r1.error}`);
  const rich = normalizeProgress({ currency: 100, books: { B1: 3, B2: 1 } });
  const r2 = applyBooks(cfg, rich, 'C001', 'B1', 3);
  check(
    r2.ok && r2.progress.currency === 70 && !('B1' in r2.progress.books) && r2.progress.levels.C001.level === 3 && r2.progress.levels.C001.exp === 25,
    '使用 3 本初级经验书：消耗 30 金币，+300 经验 → 3 级',
  );
  check(!applyBooks(cfg, rich, 'C001', 'B2', 2).ok, '经验书不够时不能使用');
  const maxed = normalizeProgress({ currency: 999, books: { B1: 5 }, levels: { C001: { level: 20, exp: 0 } } });
  check(!applyBooks(cfg, maxed, 'C001', 'B1', 1).ok, '满级后不能再使用经验书');
  check(usefulBooks({ ...cfg, maxLevel: 3 }, { level: 1, exp: 0 }, cfg.books[0]) === 3, '升到满级最多用得上 3 本（275 经验）');
  check(levelMap(cfg, normalizeProgress({ levels: { A: { level: 4, exp: 0 }, B: { level: 99 } } })).B === 20, '等级不会超过等级上限');

  const healer = normalizeCharacter({ id: 'H', atk: -100, attackTarget: 'ally', growth: { maxHp: 0, atk: 10, def: 0, res: 0 } });
  check(leveledCharacter(healer, 3).atk === -120, '治疗角色的攻击力成长 = 治疗量增加（100 → 120）');
  check(normalizeCharacter({ id: 'X', maxHp: 2000, atk: 80, def: 40 }).growth.maxHp === 100, '没有设置升级成长的角色：默认每级增加基础数值的 5%');

  const seq = (vals: number[]) => {
    let i = 0;
    return () => vals[i++ % vals.length];
  };
  // 关卡奖励 = 基础奖励（货币编辑）× 关卡的奖励倍数
  const cfg2 = {
    ...cfg,
    defaultCurrency: 80,
    defaultBooks: [
      { bookId: 'B1', chance: 100, min: 2, max: 3 },
      { bookId: 'B2', chance: 50, min: 1, max: 1 },
      { bookId: 'XX', chance: 100, min: 1, max: 1 },
    ],
  };
  const rolled = rollRewards(cfg2, { rewardMultiplier: 1 }, seq([0.1, 0.99, 0.5, 0.6]));
  check(rolled.currency === 80 && rolled.books.B1 === 3 && !rolled.books.B2 && !rolled.books.XX, `1 倍：80 金币，B1 ×${rolled.books.B1}，B2 没掉（60% ≥ 50%），不存在的经验书被忽略`);
  const rolled2 = rollRewards(cfg2, { rewardMultiplier: 2 }, seq([0.1, 0, 0.5, 0.3, 0, 0.5]));
  check(rolled2.currency === 160 && rolled2.books.B1 === 4 && rolled2.books.B2 === 2, `2 倍：160 金币，B1 ×${rolled2.books.B1}（2 × 2），B2 ×${rolled2.books.B2}`);
  const r15a = rollRewards(cfg2, { rewardMultiplier: 1.5 }, seq([0.1, 0.99, 0.4, 0.99]));
  const r15b = rollRewards(cfg2, { rewardMultiplier: 1.5 }, seq([0.1, 0.99, 0.6, 0.99]));
  check(r15a.currency === 120 && r15a.books.B1 === 5 && r15b.books.B1 === 4, '1.5 倍：3 × 1.5 = 4.5 本 → 按概率得到 4 或 5 本（期望值不变）');
  const info15 = levelRewardInfo(cfg2, { rewardMultiplier: 1.5 });
  check(info15.currency === 120 && dropCountText(info15.books[0]) === '×3~5' && info15.books.length === 2, `关卡选择显示：120 金币，初级 ${dropCountText(info15.books[0])}`);
  const info0 = levelRewardInfo(cfg2, { rewardMultiplier: 0 });
  check(info0.currency === 0 && info0.books.length === 0, '0 倍 = 没有通关奖励');
  check(normalizeLevel({ id: 'Z_1', settings: { rewardCurrency: 5, rewardBooks: [] } }).settings.rewardMultiplier === 1, '旧的关卡数据默认 1 倍');
  const after = grantRewards(normalizeProgress({ currency: 5, books: { B1: 1 } }), rolled);
  check(after.currency === 85 && after.books.B1 === 4, '奖励加进玩家进度');
  const np = normalizeProgress({ currency: -5, books: { B1: 2.7, B2: -1 }, levels: { C1: { level: 0, exp: -3 }, C2: { level: 3, exp: 12 } } });
  check(np.currency === 0 && np.books.B1 === 2 && !('B2' in np.books) && !('C1' in np.levels) && np.levels.C2.level === 3, '读取进度时修正非法的数值');
}

console.log('\n[8] 负数数值');
{
  const base = { maxHp: 1000, atk: 100, def: -50, res: -100, attackInterval: 1, range: 1, targetCount: 1, blockCount: 1, speed: 1, hpRegen: 0 };
  check(computeDamage(100, 'physical', -50, 0) === 150, '物抗 −50：100 物伤 → 150');
  check(computeDamage(100, 'magic', 0, -100) === 200, '法抗 −100：100 法伤 → 200（两倍）');
  const up = applyModifiers(base, [[{ stat: 'def', mode: 'percent', value: 30 }]]);
  check(up.def === -35, `负数物抗 +30%：−50 → ${up.def}（百分比按绝对值，总是变高）`);
  const pos = applyModifiers({ ...base, def: 20, res: 10 }, [[{ stat: 'def', mode: 'add', value: -40 }, { stat: 'res', mode: 'add', value: -30 }]]);
  check(pos.def === 0 && pos.res === 0, '原来是正数的物抗 / 法抗，减益最多降到 0（和以前一样）');
  check(applyModifiers(base, [[{ stat: 'def', mode: 'add', value: -40 }]]).def === -50, '基础物抗是负数时，减益不会让它更低');

  const neg = normalizeCharacter({ id: 'NG', maxHp: 300, atk: 50, def: 10, res: 5, cost: -6, placement: 'high', range: 0, growth: { maxHp: -100, atk: -20, def: -10, res: -5 } });
  check(neg.cost === -6 && neg.growth.maxHp === -100 && neg.growth.res === -5, '费用和升级成长可以保存为负数');
  const lv4 = leveledCharacter(neg, 4);
  check(lv4.maxHp === 1 && lv4.atk === 0 && lv4.def === -20 && lv4.res === -10, `负数成长 4 级：生命 ${lv4.maxHp}（最少 1）· 攻击 ${lv4.atk}（最少 0）· 物抗 ${lv4.def} · 法抗 ${lv4.res}`);
  const healer = normalizeCharacter({ id: 'NH', atk: -100, attackTarget: 'ally', growth: { maxHp: 0, atk: -30, def: 0, res: 0 } });
  check(leveledCharacter(healer, 3).atk === -40 && leveledCharacter(healer, 6).atk === 0, '治疗角色的负数成长减少治疗量，最多减到 0（不会变成攻击）');

  // 负数费用 / 击杀奖励 / 每分钟回复
  const lvM = normalizeLevel({
    id: 'T_3',
    width: 6,
    height: 2,
    grid: ['SGGGGB', 'HHHHHH'],
    settings: { initialHp: 99, initialMoney: 10, autoMoney: true, moneyPerMinute: -60 },
    lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [{ id: 'b', enemyId: 'NE', count: 2, interval: 1, startTime: 0 }] }],
  });
  const hostage = normalizeEnemy({ id: 'NE', maxHp: 1, speed: 0.05, canAttack: false, reward: -4 });
  const engN = new GameEngine(lvM, [neg], [hostage], { skills: [] });
  check(engN.deploy('NG', { x: 0, y: 1 }) === null && engN.money === 16, `费用 −6：部署后金钱 10 → ${engN.money}`);
  const back = engN.retreat(engN.units[0].uid);
  check(back === -3 && engN.money === 13, `撤退时扣回一半：${back}，金钱 → ${engN.money}`);
  for (let t = 0; t < 2; t += FIXED_DT) engN.step(FIXED_DT);
  check(engN.money > 10.9 && engN.money < 11.1, `每分钟回复 −60：2 秒后金钱 13 → ${engN.money.toFixed(2)}`);
  engN.enemies[0].hp = 0;
  engN.step(FIXED_DT);
  check(engN.money < 7.1 && engN.money > 6.8, `击杀奖励 −4：击败后金钱 → ${engN.money.toFixed(2)}`);
  for (let t = 0; t < 10; t += FIXED_DT) engN.step(FIXED_DT);
  check(engN.money === 0, '金钱减少到 0 为止');
}

console.log('\n[9] 无尽模式');
{
  const cfg = { ...newEndlessConfig(), startDifficulty: 1, difficultyPerWave: 1, groupsPerWave: 2, groupsGrowth: 0.5, countPerRank: 1, intervalPerRank: 0.5, countGrowth: 0, hpGrowth: 10, atkGrowth: 0, firstWave: 2, waveInterval: 10 };
  const mk = (id: string, d: number, rank: number, score: number) => normalizeEnemy({ id, name: id, maxHp: 100, speed: 0.2, canAttack: false, endlessDifficulty: d, endlessRank: rank, endlessScore: score });
  const easy = mk('EA', 1, 1, 5);
  const mid = mk('EM', 3, 3, 10);
  const hard = mk('EH', 5, 2, 30);
  const all = [easy, mid, hard];
  check(eligibleEnemies(cfg, all, 1).map((p) => p.def.id).join() === 'EA', '第 1 波（难度 1）只出现难度 1 的敌人');
  const w3 = eligibleEnemies(cfg, all, 3);
  check(w3.length === 2 && w3[0].weight < w3[1].weight, `第 3 波：难度 1 和 3 的敌人都会出现，越接近当前难度权重越高（${w3.map((p) => p.weight.toFixed(2)).join(' / ')}）`);
  check(firstWaveOf(cfg, 5) === 5 && firstWaveOf({ ...cfg, difficultyPerWave: 0 }, 5) === null, '难度 5 的敌人从第 5 波开始出现；难度不增加时永远不出现');
  const g1 = groupSize(cfg, 1, 1);
  const g3 = groupSize(cfg, 3, 1);
  check(g1.count === 1 && g3.count === 3 && g3.interval > g1.interval, `出现位列越低，每组越少、间隔越短（位列 1：${g1.count} 个；位列 3：${g3.count} 个，间隔 ${g3.interval} 秒）`);
  check(groupSize({ ...cfg, countGrowth: 50 }, 2, 3).count === 4, '每波数量增加 50%：第 3 波位列 2 → 4 个');
  check(waveGroupCount(cfg, 1) === 2 && waveGroupCount(cfg, 5) === 4, '组数：第 1 波 2 组，每波 +0.5 → 第 5 波 4 组');
  const plan = planWave(cfg, all, 2, 7, seededRng(3));
  check(plan.groups.length === 5 && plan.groups.every((g) => g.routeIndex >= 0 && g.routeIndex < 2), `第 7 波：${plan.groups.length} 组，每组随机选路线`);
  check(Math.abs(plan.hpScale - 1.6) < 1e-9, '每波生命 +10%：第 7 波 ×1.6');
  check(eligibleEnemies({ ...cfg, startDifficulty: -10, difficultyPerWave: 0 }, all, 1).map((p) => p.def.id).join() === 'EA', '没有敌人够格时使用难度最低的敌人（每波都有敌人）');

  // 战斗：用固定的随机数跑 33 秒 → 第 1 波在 2 秒，之后每 10 秒一波 → 4 波
  const lvE = normalizeLevel({
    id: 'ENDLESS_1',
    width: 6,
    height: 2,
    grid: ['SGGGGB', 'HHHHHH'],
    settings: { initialHp: 999, initialMoney: 0, autoMoney: false },
    lines: [{ id: 'L', name: '路线', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [] }],
  });
  const engE = new GameEngine(lvE, [], all, { skills: [], endless: cfg, rng: seededRng(11) });
  check(engE.routes.length === 1 && engE.warnings.length === 0, '没有积木的敌人线也可以作为无尽模式的路线');
  for (let t = 0; t < 33; t += FIXED_DT) engE.step(FIXED_DT);
  check(engE.wave === 4 && engE.status === 'running', `33 秒：第 ${engE.wave} 波，战斗继续（无尽模式没有胜利）`);
  const strongest = Math.max(...engE.enemies.map((e) => e.base.maxHp));
  check(strongest === 130, `第 4 波的敌人生命 ×1.3：100 → ${strongest}`);
  const before = engE.score;
  const target = engE.enemies[0];
  target.hp = 0;
  engE.step(FIXED_DT);
  check(engE.score === before + target.def.endlessScore, `击败敌人获得分数：+${target.def.endlessScore}`);
  engE.finish();
  check(engE.status === 'lost' && engE.finishedByPlayer, '主动结束挑战');
  const ecfg = { ...cfg, currencyRate: { score: 10, amount: 50 }, bookRates: [{ bookId: 'B1', score: 20, amount: 1 }, { bookId: 'XX', score: 1, amount: 1 }] };
  const curCfg = normalizeCurrency({ books: [{ id: 'B1', name: '初级', exp: 100, cost: 10 }] });
  const er = endlessRewards(ecfg, curCfg, 95);
  check(er.currency === 450 && er.books.B1 === 4 && !er.books.XX, `95 分 → ${er.currency} 金币（每 10 分 50）+ 初级经验书 ×${er.books.B1}（每 20 分 1 本）`);
  check(endlessRewards(ecfg, curCfg, -30).currency === 0, '负分不会扣奖励');
  const ne = normalizeEndless({ waveInterval: -5, hpGrowth: -20, bookRates: [{ bookId: '' }], map: { grid: ['SB'] } });
  check(ne.waveInterval === 1 && ne.hpGrowth === -20 && ne.bookRates.length === 0 && ne.map.id === 'ENDLESS_1' && ne.map.chapterId === 'ENDLESS', '读取无尽模式设置时修正非法的数值（每波生命可以是负数）');
  const de = normalizeEnemy({ id: 'D', maxHp: 1400 });
  check(de.endlessScore === 14 && de.endlessDifficulty === 3 && de.endlessRank === 1, `没有设置的敌人按生命值估算：分数 ${de.endlessScore} · 难度 ${de.endlessDifficulty} · 位列 ${de.endlessRank}`);
}

console.log('\n[10] 角色试用（训练场）');
{
  const grid = ['HHHHHHH', 'GGGGGGG', 'HHHHHHH'];
  const lvT = normalizeLevel({ id: 'TRIAL_1', width: 7, height: 3, grid, settings: { initialHp: 99, initialMoney: 99999, autoMoney: false }, lines: [] });
  const path = Array.from({ length: 7 }, (_, x) => ({ x, y: 1 }));
  const dummyT = normalizeEnemy({ id: 'DM', maxHp: 1000, speed: 2, canAttack: false });
  const shooter = normalizeCharacter({ id: 'SH', placement: 'high', cost: 0, atk: 100, range: 2, attackInterval: 1, damageType: 'true' });
  const engT = new GameEngine(lvT, [shooter], [dummyT], { skills: [], training: { enemyId: 'DM', path, respawnDelay: 1 } });
  check(engT.enemies.length === 1 && engT.enemies[0].patrol === true, '一开始就有一个来回移动的敌人');
  let maxX = 0;
  let back = false;
  let lastX = engT.enemies[0].x;
  for (let t = 0; t < 8; t += FIXED_DT) {
    engT.step(FIXED_DT);
    const e = engT.enemies[0];
    maxX = Math.max(maxX, e.x);
    if (e.x < lastX - 1e-9) back = true;
    lastX = e.x;
  }
  check(engT.leaked === 0 && engT.status === 'running' && Math.abs(maxX - 6.5) < 1e-6 && back, `走到头（x = ${maxX}）就掉头往回走，不会进入基地，试用不会结束`);
  engT.frozen = true;
  const fx = engT.enemies[0].x;
  for (let t = 0; t < 1; t += FIXED_DT) engT.step(FIXED_DT);
  check(engT.enemies[0].x === fx, '停止移动后敌人停在原地');
  engT.frozen = false;
  check(engT.deploy('SH', { x: 3, y: 0 }) === null, '可以再部署角色');
  engT.frozen = true;
  engT.enemies[0].x = 3.5;
  engT.resetMeter();
  for (let t = 0; t < 3.05; t += FIXED_DT) engT.step(FIXED_DT);
  const hurt = engT.enemies[0].hp;
  check(hurt < 1000 && Math.abs(engT.damageDealt - (1000 - hurt)) < 1e-6, `伤害统计：${engT.damageDealt}（敌人 1000 → ${hurt}）`);
  engT.refillEnemies();
  check(engT.enemies[0].hp === engT.enemies[0].stats.maxHp, '刷新血量：敌人回满生命');
  engT.enemies[0].hp = 0;
  engT.step(FIXED_DT);
  check(engT.enemies.length === 0, '敌人被击败后暂时消失');
  for (let t = 0; t < 1.05; t += FIXED_DT) engT.step(FIXED_DT);
  check(engT.enemies.length === 1 && engT.enemies[0].hp === 1000, '1 秒后重新出现（满血）');
  engT.enemies[0].hp = 0;
  engT.step(FIXED_DT);
  engT.refillEnemies();
  check(engT.enemies.length === 1, '被击败后点「刷新血量」立即重新出现');
}

console.log('\n[11] 持续治疗 / 持续伤害');
{
  const lvR = normalizeLevel({
    id: 'T_9',
    width: 6,
    height: 2,
    grid: ['SGGGGB', 'HHHHHH'],
    settings: { initialHp: 99, initialMoney: 999, autoMoney: false },
    lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [{ id: 'b', enemyId: 'RT', count: 1, interval: 1, startTime: 0 }] }],
  });
  const target = normalizeEnemy({ id: 'RT', maxHp: 10000, speed: 0.01, canAttack: false, def: 10, res: 50 });
  const sk = (id: string, eff: object) => normalizeSkill({ id, name: id, spMax: 1, spInitial: 1, spGain: 'auto', spRate: 0, trigger: 'manual', duration: 5, effects: [eff] });
  const hot = sk('HOT', { kind: 'regen', target: 'self', amount: 30, duration: 5 });
  const dotP = sk('DOTP', { kind: 'regen', target: 'enemies', scope: 'all', amount: -50, damageType: 'physical', duration: 5 });
  const dotM = sk('DOTM', { kind: 'regen', target: 'enemies', scope: 'all', amount: -50, damageType: 'magic', duration: 0 });
  const dotA = sk('DOTA', { kind: 'regen', target: 'enemies', scope: 'all', amount: -10, regenMode: 'atk', damageType: 'true', duration: 3 });
  check(hot.effects[0].kind === 'regen' && dotA.effects[0].regenMode === 'atk', '持续治疗效果可以保存 / 读取');
  const caster = (skill: string) => normalizeCharacter({ id: 'RC', placement: 'high', cost: 0, atk: 200, maxHp: 1000, range: 0, skills: [skill], skillSlots: 1 });
  const run = (eng: GameEngine, sec: number) => {
    for (let t = 0; t < sec; t += FIXED_DT) eng.step(FIXED_DT);
  };

  const e1 = new GameEngine(lvR, [caster('HOT')], [target], { skills: [hot] });
  e1.deploy('RC', { x: 0, y: 1 });
  const u = e1.units[0];
  u.hp = 500;
  e1.activateSkill(u.uid, 0);
  run(e1, 0.9);
  check(u.hp === 500 && u.regens.length === 1, '施加后第 1 秒才开始治疗');
  run(e1, 4.3);
  check(u.hp === 650 && u.regens.length === 0, `每秒 +30，持续 5 秒 = 5 次：500 → ${u.hp}`);

  const e2 = new GameEngine(lvR, [caster('DOTP')], [target], { skills: [dotP] });
  e2.step(FIXED_DT);
  e2.deploy('RC', { x: 0, y: 1 });
  e2.activateSkill(e2.units[0].uid, 0);
  run(e2, 5.2);
  check(e2.enemies[0].hp === 10000 - 5 * 40, `持续物伤 50 / 秒，物抗 10：5 次共 ${10000 - e2.enemies[0].hp}`);

  const e3 = new GameEngine(lvR, [caster('DOTM')], [target], { skills: [dotM] });
  e3.step(FIXED_DT);
  e3.deploy('RC', { x: 0, y: 1 });
  e3.activateSkill(e3.units[0].uid, 0);
  run(e3, 5.2);
  check(e3.enemies[0].hp === 10000 - 5 * 25, `持续法伤 50 / 秒，法抗 50%，持续时间跟随技能（5 秒）：共 ${10000 - e3.enemies[0].hp}`);

  const e4 = new GameEngine(lvR, [caster('DOTA')], [target], { skills: [dotA] });
  e4.step(FIXED_DT);
  e4.deploy('RC', { x: 0, y: 1 });
  e4.activateSkill(e4.units[0].uid, 0);
  run(e4, 3.2);
  check(e4.enemies[0].hp === 10000 - 3 * 20, `攻击力 10% 的真伤（攻击力 200）：3 次共 ${10000 - e4.enemies[0].hp}`);
}

console.log('\n[12] 召唤物');
{
  const lvS = normalizeLevel({
    id: 'T_10',
    width: 7,
    height: 3,
    grid: ['HHHHHHH', 'SGGGGGB', 'HHHHHHH'],
    settings: { initialHp: 99, initialMoney: 999, autoMoney: false },
    lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 1 } }, blocks: [{ id: 'b', enemyId: 'SD', count: 1, interval: 1, startTime: 0 }] }],
  });
  const dummyS = normalizeEnemy({ id: 'SD', maxHp: 100000, speed: 0.01, canAttack: true, atk: 500, attackRange: 9, attackInterval: 0.5 });
  const m1 = normalizeSummon({ id: 'M1', name: '小狼', placement: 'any', cost: 2, maxHp: 300, atk: 40, range: 1, maxDeploy: 2, inherit: { maxHp: 50, atk: 50 } });
  const m2 = normalizeSummon({ id: 'M2', name: '盾', placement: 'any', cost: 0, maxHp: 100, attackType: 'none', invincible: true, nearSummoner: true, keepAfterSummoner: true });
  check(isSummonDef(m1) && m2.attackType === 'none' && m2.invincible && m2.nearSummoner, '召唤物可以保存 / 读取（不攻击、无敌、部署范围、离场保留）');
  const caller = normalizeCharacter({ id: 'SC', name: '召唤师', placement: 'high', cost: 0, maxHp: 1000, atk: 100, range: 1, attackType: 'summon', summonAttack: 'none', summons: ['M1', 'M2'] });
  check(caller.attackType === 'summon' && caller.summonAttack === 'none' && caller.summons.join() === 'M1,M2', '角色的攻击方式可以是「召唤」');
  const run = (eng: GameEngine, sec: number) => {
    for (let t = 0; t < sec; t += FIXED_DT) eng.step(FIXED_DT);
  };

  const eng = new GameEngine(lvS, [caller], [dummyS], { skills: [], summons: [m1, m2] });
  check(eng.activeSummons.length === 0 && eng.deploy('M1', { x: 2, y: 1 }) !== null, '召唤者不在场时，召唤物不在部署栏里，不能部署');
  eng.deploy('SC', { x: 3, y: 0 });
  check(eng.activeSummons.map((s) => s.id).join() === 'M1', '召唤者部署后，默认的召唤物（第一个）出现在部署栏');
  check(eng.deploy('M1', { x: 2, y: 1 }) === null, '把召唤物部署到地图上');
  const wolf = eng.units.find((x) => x.def.id === 'M1')!;
  check(wolf.base.maxHp === 800 && wolf.base.atk === 90 && wolf.summonerUid === eng.units[0].uid, `继承召唤者 50% 的生命和攻击：生命 ${wolf.base.maxHp}（300 + 500），攻击 ${wolf.base.atk}（40 + 50）`);
  eng.deploy('M1', { x: 4, y: 1 });
  check(!!eng.deploy('M1', { x: 5, y: 1 }), '召唤物也有同时部署上限');
  eng.step(FIXED_DT);
  run(eng, 1);
  check(eng.projectiles.every((p) => p.sourceUid !== eng.units[0].uid), '召唤者的「自身攻击」设为不攻击时，自己不攻击');
  eng.retreat(eng.units[0].uid);
  check(!eng.units.some((x) => x.def.id === 'M1') && eng.activeSummons.length === 0, '召唤者撤退后，召唤物一起离场，部署栏里的召唤物也消失');

  const eng2 = new GameEngine(lvS, [caller], [dummyS], { skills: [], summons: [m1, m2], summonChoice: { SC: 'M2' } });
  eng2.deploy('SC', { x: 3, y: 0 });
  check(eng2.activeSummons.map((s) => s.id).join() === 'M2', '玩家选择了第二个召唤物时，部署栏里出现的是它');
  const far = eng2.deploy('M2', { x: 6, y: 0 });
  check(!!far && far.includes('攻击范围'), `只能放在召唤者攻击范围内：${far}`);
  check(eng2.deploy('M2', { x: 3, y: 1 }) === null, '放在召唤者攻击范围内可以部署');
  run(eng2, 3);
  const shield = eng2.units.find((x) => x.def.id === 'M2')!;
  check(shield.hp === shield.stats.maxHp, '无敌的召唤物不会受到伤害');
  eng2.units[0].hp = 0;
  eng2.step(FIXED_DT);
  check(eng2.units.some((x) => x.def.id === 'M2'), '设置了「召唤者离场后保留」的召唤物，召唤者被击败后仍然在场');
}

console.log('\n[13] 编队');
{
  const many = Array.from({ length: 15 }, (_, i) => normalizeCharacter({ id: `Q${i + 1}`, name: `角色${i + 1}` }));
  const ids = (list: CharacterDef[]) => list.map((c) => c.id).join(',');
  check(resolveSquad(many, []).length === 12 && resolveSquad(many, [])[0].id === 'Q1', '还没有编队时 = 前 12 个角色');
  check(ids(resolveSquad(many, ['Q15', 'Q3', 'X', 'Q7'])) === 'Q15,Q3,Q7', '编队按玩家的顺序，不存在的角色被跳过');
  check(resolveSquad(many, ['X', 'Y']).length === 12, '编队里的角色都被删除了 → 回到前 12 个');
  check(normalizeProgress({ squad: ['A', 'B', 'A', ...many.map((c) => c.id)] }).squad.length === 12, '读取进度时编队去掉重复，最多 12 个');
  const r1 = battleRoster(many, ['Q2', 'Q9', 'Q4'], ['Q4', 'Q9', 'Q14']);
  check(ids(r1.roster) === 'Q9,Q4' && !r1.fallback, '关卡只允许部分角色时：出战 = 编队 ∩ 本关可用（按编队顺序）');
  const r2 = battleRoster(many, ['Q1', 'Q2'], ['Q14', 'Q15']);
  check(ids(r2.roster) === 'Q14,Q15' && r2.fallback, '编队里没有本关可用的角色 → 使用本关指定的角色');
  const engQ = new GameEngine(levels[0], battleRoster(characters, characters.slice(-3).map((c) => c.id).reverse(), []).roster, enemies, { skills });
  check(ids(engQ.roster) === characters.slice(-3).map((c) => c.id).reverse().join(','), `战斗的部署栏按编队顺序：${ids(engQ.roster)}`);
}

console.log('\n[14] 敌人的召唤物');
{
  const lvE = normalizeLevel({
    id: 'T_14',
    width: 10,
    height: 3,
    grid: ['HHHHHHHHHH', 'SGGGGGGGGB', 'HHHHHHHHHH'],
    settings: { initialHp: 10, initialMoney: 0, autoMoney: false },
    lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 1 } }, blocks: [{ id: 'b', enemyId: 'SUM', count: 1, interval: 1, startTime: 0 }] }],
  });
  // 战斗结束后时间不再前进，所以只在战斗进行中推进
  const runUntil = (eng: GameEngine, time: number) => {
    while (eng.status === 'running' && eng.time < time - 1e-9) eng.step(FIXED_DT);
  };
  const oldEnemy = normalizeEnemy({ id: 'OLD' });
  check(oldEnemy.summonAttack === 'basic' && oldEnemy.summons.length === 0 && normalizeSummon({ id: 'OLDM' }).side === 'ally', '旧数据：敌人没有召唤物，召唤物默认是角色的召唤物');
  const es1 = normalizeSummon({
    id: 'ES1',
    name: '小鬼',
    side: 'enemy',
    maxHp: 200,
    atk: 20,
    speed: 1,
    sides: 4,
    reward: 3,
    endlessScore: 2,
    summonFirst: 1,
    summonInterval: 2,
    summonCount: 1,
    maxDeploy: 2,
    attackType: 'none',
    inherit: { maxHp: 10, atk: 50, def: 0, res: 0 },
  });
  const es2 = normalizeSummon({ id: 'ES2', name: '护卫', side: 'enemy', maxHp: 50, speed: 0.2, summonFirst: 0.5, summonInterval: 0, maxDeploy: 0, invincible: true, keepAfterSummoner: true, inherit: { maxHp: 0, atk: 0, def: 0, res: 0 } });
  check(
    es1.side === 'enemy' && es1.speed === 1 && es1.sides === 4 && es1.summonFirst === 1 && es1.summonInterval === 2 && es1.maxDeploy === 2 && es2.summonInterval === 0,
    '敌人的召唤物可以保存 / 读取（移动速度、外形、召唤节奏、同时存在上限）',
  );
  check(normalizeSummon({ side: 'enemy', summonInterval: 0.1 }).summonInterval === 0.5, '召唤间隔最短 0.5 秒（0 = 只召唤一次）');
  const sum = normalizeEnemy({ id: 'SUM', name: '召唤师', maxHp: 1000, atk: 100, speed: 0.5, attackType: 'summon', summonAttack: 'none', summons: ['ES1', 'ES2'] });
  check(sum.attackType === 'summon' && sum.summonAttack === 'none' && sum.summons.join() === 'ES1,ES2', '敌人的攻击方式可以是「召唤」');
  check(describeAttack(sum) === '召唤 · 自身不攻击' && describeAttack({ ...sum, summonAttack: 'area' }).startsWith('召唤 · 自身：'), `敌人的攻击说明：${describeAttack(sum)}`);

  const eng = new GameEngine(lvE, [], [sum], { skills: [], summons: [es1, es2] });
  runUntil(eng, 0.45);
  check(eng.enemies.length === 1 && !eng.enemies[0].summon, '召唤者出现后，「首次召唤」之前不会召唤');
  const owner = eng.enemies[0];
  runUntil(eng, 0.55);
  const guard = eng.enemies.find((e) => e.def.id === 'ES2');
  check(!!guard && Math.abs(guard.x - owner.x) < 0.05 && Math.abs(guard.y - owner.y) < 0.05, '召唤物出现在召唤者的位置');
  check(!!guard && guard.path === owner.path && guard.waypoint === owner.waypoint, '召唤物沿召唤者剩下的路线前进');
  runUntil(eng, 1.1);
  const imp = eng.enemies.find((e) => e.def.id === 'ES1');
  check(!!imp && imp.base.maxHp === 300 && imp.base.atk === 70 && imp.summonerUid === owner.uid, `继承召唤者的数值：生命 ${imp?.base.maxHp}（200 + 1000 × 10%），攻击 ${imp?.base.atk}（20 + 100 × 50%）`);
  check(!!imp && imp.def.size < 1 && imp.stats.speed === 1 && !imp.def.canAttack, '召唤物比敌人小，按自己的移动速度前进，可以设置为不攻击');
  check(eng.totalEnemies === 1, '召唤物不算在敌人总数里');
  runUntil(eng, 3.1);
  check(eng.enemies.filter((e) => e.def.id === 'ES1').length === 2, '之后按召唤间隔继续召唤');
  runUntil(eng, 5.1);
  check(eng.enemies.filter((e) => e.def.id === 'ES1').length === 2 && eng.enemies.filter((e) => e.def.id === 'ES2').length === 1, '每个召唤者同时存在的数量不超过上限；召唤间隔为 0 时只召唤一次');
  check(!!imp && imp.x > owner.x + 1, '召唤物比召唤者走得快时走在前面');
  check(eng.dealDamage(guard!, 999, 'true') === 0, '无敌的敌人召唤物不会受到伤害');
  runUntil(eng, 10);
  check(eng.summonsLeaked >= 1 && eng.leaked === 0 && eng.hp < 10, `召唤物进入基地同样扣血（召唤物进入基地 ${eng.summonsLeaked}，血量 ${eng.hp}/10），不算在敌人的进入基地里`);
  const victim = eng.enemies.find((e) => e.def.id === 'ES1')!;
  victim.hp = 0;
  eng.step(FIXED_DT);
  check(eng.summonsKilled === 1 && eng.killed === 0 && eng.money === 3, `击败召唤物获得它的奖励（金钱 ${eng.money}），不算在击败敌人里`);
  owner.hp = 0;
  eng.step(FIXED_DT);
  check(
    !eng.enemies.some((e) => e.def.id === 'ES1') && eng.enemies.some((e) => e.def.id === 'ES2') && eng.killed === 1 && eng.money === 3,
    '召唤者被击败后召唤物一起消失（没有奖励），设置了「召唤者离场后保留」的留下',
  );
  check(eng.status === 'running', '还有召唤物在场时，战斗没有结束');
  runUntil(eng, 80);
  check(eng.status === 'won' && eng.enemies.length === 0, `场上的召唤物全部离场后才胜利（${eng.status}）`);

  // 无尽模式的波次加成：召唤物自己的数值按召唤者的加成
  const engS = new GameEngine(lvE, [], [sum], { skills: [], summons: [es1] });
  engS.step(FIXED_DT);
  engS.enemies[0].hpScale = 2;
  engS.enemies[0].atkScale = 2;
  runUntil(engS, 1.1);
  const scaled = engS.enemies.find((e) => e.summon);
  check(!!scaled && scaled.base.maxHp === 500 && scaled.base.atk === 90, `无尽模式的波次加成同样作用在召唤物上：生命 ${scaled?.base.maxHp}，攻击 ${scaled?.base.atk}`);

  // 阵营限制：角色不能召唤敌人的召唤物，敌人不能召唤角色的召唤物
  const wrongChar = normalizeCharacter({ id: 'BC', name: '错召唤', attackType: 'summon', summons: ['ES1'] });
  const allyM = normalizeSummon({ id: 'MA', name: '友方' });
  const wrongEnemy = normalizeEnemy({ id: 'SUM', name: '孤独召唤师', attackType: 'summon', summons: ['MA'] });
  const engB = new GameEngine(lvE, [wrongChar], [wrongEnemy], { skills: [], summons: [es1, allyM] });
  check(engB.chosenSummon(engB.roster[0]) === null && engB.warnings.some((w) => w.includes('错召唤')), '角色不能召唤敌人的召唤物（有提示）');
  check(engB.enemySummonsOf(wrongEnemy).length === 0 && engB.warnings.some((w) => w.includes('孤独召唤师')), '敌人不能召唤角色的召唤物（有提示）');

  // 角色试用：召唤物和试用的敌人一样来回移动；试用的敌人被击败后照样重新出现
  // 试用的地图没有敌人线，只有来回移动的敌人
  const engT = new GameEngine({ ...lvE, lines: [] }, [], [sum], {
    skills: [],
    summons: [es1],
    training: { enemyId: 'SUM', path: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], respawnDelay: 1 },
  });
  runUntil(engT, 1.2);
  check(engT.enemies.some((e) => e.summon && e.patrol), '角色试用：召唤物也来回移动，不会进入基地');
  engT.enemies.find((e) => !e.summon)!.hp = 0;
  runUntil(engT, 2.5);
  check(engT.enemies.some((e) => !e.summon && e.hp > 0) && engT.enemies.filter((e) => e.summon).length === 0, '角色试用：召唤者被击败后召唤物消失，召唤者重新出现');
}

console.log(failures ? `\n失败 ${failures} 项` : warnings ? `\n全部通过（${warnings} 项提醒）` : '\n全部通过');
process.exit(failures ? 1 : 0);
