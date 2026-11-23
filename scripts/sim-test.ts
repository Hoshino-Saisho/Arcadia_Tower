/**
 * 无界面测试：npm test
 *  1. 寻路 / 手动路线校验
 *  2. 数据校验（路线、引用的敌人 / 技能 ID）
 *  3. 解锁规则
 *  4. 战斗机制：物伤 / 法伤、治疗、多目标、技能 SP 与释放、增益减益、生命上限同步、金钱技能、角色技能设定、
 *     停留点、转圈路线、部署冷却、角色等级
 *  5. 用简单的自动部署策略把每个关卡模拟打一遍
 *  6. 手机版舞台的坐标换算（缩放 / 旋转 90°）
 *  7. 升级与通关奖励：升级经验表、经验书、升级成长、掉落
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeCharacter,
  normalizeChapter,
  normalizeCurrency,
  normalizeEnemy,
  normalizeLevel,
  normalizeProgress,
  normalizeSkill,
  resolveLoadout,
} from '../src/core/defaults';
import {
  addExp,
  applyBooks,
  expTable,
  grantRewards,
  leveledCharacter,
  levelMap,
  levelRewardInfo,
  rollRewards,
  usefulBooks,
} from '../src/core/leveling';
import { checkManualPath, findPath, resolveRoute, resolveWaits, visitNumbers } from '../src/core/pathfinding';
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
  for (const d of lv.settings.rewardBooks ?? []) if (!currency.books.some((b) => b.id === d.bookId)) check(false, `${lv.id} 通关奖励中的经验书 ${d.bookId} 不存在`);
}
check(currency.books.length > 0 && currency.maxLevel >= 1, `货币设置：${currency.name}，经验书 ${currency.books.length} 种，等级上限 ${currency.maxLevel}`);
check(
  currency.defaultBooks.every((d) => currency.books.some((b) => b.id === d.bookId)),
  '默认通关掉落引用的经验书都存在',
);

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
  const gunner = charById.get('C007')!;
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
    check(u.stats.maxHp === 100 && Math.abs(u.hp - 40) < 1e-6, `效果结束后恢复：→ ${u.stats.maxHp} / ${Math.round(u.hp)}`);
    st('b', 'maxHp', 'add', -30);
    check(u.stats.maxHp === 70 && Math.abs(u.hp - 10) < 1e-6, `生命上限 −30（固定值）：100 / 40 → ${u.stats.maxHp} / ${u.hp}`);
    st('c', 'maxHp', 'add', -50);
    check(u.stats.maxHp === 20 && u.hp === 1, `上限降低不会直接致死（最少保留 1 点）：→ ${u.stats.maxHp} / ${u.hp}`);
    u.hp = u.stats.maxHp;
    st('d', 'maxHp', 'add', 50);
    check(u.stats.maxHp === 70 && u.hp === 70, '满血时提高上限，生命同样增加（仍然满血）');
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
  const settings = { rewardCurrency: null, rewardBooks: [{ bookId: 'B1', chance: 100, min: 2, max: 3 }, { bookId: 'B2', chance: 50, min: 1, max: 1 }, { bookId: 'XX', chance: 100, min: 1, max: 1 }] };
  const cfg2 = { ...cfg, defaultCurrency: 80 };
  const rolled = rollRewards(cfg2, settings, seq([0.1, 0.99, 0.6]));
  check(rolled.currency === 80 && rolled.books.B1 === 3 && !rolled.books.B2 && !rolled.books.XX, `掉落：B1 ×${rolled.books.B1}，B2 没掉（60% ≥ 50%），不存在的经验书被忽略`);
  const rolled2 = rollRewards(cfg2, settings, seq([0.1, 0, 0.3, 0]));
  check(rolled2.books.B1 === 2 && rolled2.books.B2 === 1, 'B2 在 30% < 50% 时掉落');
  check(levelRewardInfo(cfg2, { rewardCurrency: 7, rewardBooks: [] }).currency === 7 && levelRewardInfo(cfg2, { rewardCurrency: 7, rewardBooks: [] }).books.length === 0, '关卡单独设置的奖励优先于默认值');
  const after = grantRewards(normalizeProgress({ currency: 5, books: { B1: 1 } }), rolled);
  check(after.currency === 85 && after.books.B1 === 4, '奖励加进玩家进度');
  const np = normalizeProgress({ currency: -5, books: { B1: 2.7, B2: -1 }, levels: { C1: { level: 0, exp: -3 }, C2: { level: 3, exp: 12 } } });
  check(np.currency === 0 && np.books.B1 === 2 && !('B2' in np.books) && !('C1' in np.levels) && np.levels.C2.level === 3, '读取进度时修正非法的数值');
}

console.log(failures ? `\n失败 ${failures} 项` : warnings ? `\n全部通过（${warnings} 项提醒）` : '\n全部通过');
process.exit(failures ? 1 : 0);
