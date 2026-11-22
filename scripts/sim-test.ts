/**
 * 无界面测试：npm test
 *  1. 寻路 / 手动路线校验
 *  2. 数据校验（路线、引用的敌人 / 技能 ID）
 *  3. 解锁规则
 *  4. 战斗机制：物伤 / 法伤、治疗、多目标、技能 SP 与释放、增益减益、角色技能设定
 *  5. 用简单的自动部署策略把每个关卡模拟打一遍
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeCharacter,
  normalizeChapter,
  normalizeEnemy,
  normalizeLevel,
  normalizeSkill,
  resolveLoadout,
} from '../src/core/defaults';
import { checkManualPath, findPath, resolveRoute } from '../src/core/pathfinding';
import { ProgressView } from '../src/core/progress';
import { applyModifiers, computeDamage } from '../src/core/stats';
import { TileGrid } from '../src/core/tiles';
import type { CharacterDef, EnemyDef, GridPos, LevelDef, SkillDef } from '../src/core/types';
import { FIXED_DT, GameEngine } from '../src/game/engine';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dataDir = process.env.ARCADIA_DATA_DIR ?? path.join(root, 'data');
const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8'));

let failures = 0;
function check(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.log(`  ✗ ${msg}`);
  }
}

const characters: CharacterDef[] = readJson('characters.json').characters.map(normalizeCharacter);
const enemies: EnemyDef[] = readJson('enemies.json').enemies.map(normalizeEnemy);
const skills: SkillDef[] = readJson('skills.json').skills.map(normalizeSkill);
const chapters = readJson('chapters.json').chapters.map(normalizeChapter);
const levelFiles = fs.readdirSync(path.join(dataDir, 'levels')).filter((f) => f.endsWith('.json'));
const levels: LevelDef[] = levelFiles.map((f) => normalizeLevel(readJson(`levels/${f}`), f.slice(0, -5)));
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
    for (const b of line.blocks) if (!enemyById.has(b.enemyId)) check(false, `${lv.id} 敌人 ${b.enemyId} 不存在`);
  }
}

console.log('\n[3] 进度解锁规则');
{
  const built = new Set(levels.map((l) => l.id));
  const v0 = new ProgressView(chapters, { cleared: [], loadouts: {} }, built);
  check(v0.isChapterUnlocked(0) && !v0.isChapterUnlocked(1), '初始只解锁第一章');
  check(v0.isLevelUnlocked('ZH', 1) && !v0.isLevelUnlocked('ZH', 2), '初始只解锁 ZH_1');
  const v1 = new ProgressView(chapters, { cleared: ['ZH_1', 'ZH_2', 'ZH_3'], loadouts: {} }, built);
  check(v1.isChapterUnlocked(1) && v1.isLevelUnlocked('EX', 1) && !v1.isLevelUnlocked('EX', 2), '第一章通关后解锁 EX_1，EX_2 仍锁定');
}

console.log('\n[4] 战斗机制');
{
  check(computeDamage(100, 'physical', 40, 90) === 60, '物伤：100 攻击 − 40 物抗 = 60（无视法抗）');
  check(computeDamage(100, 'magic', 999, 30) === 70, '法伤：100 攻击 × (1 − 30% 法抗) = 70（无视物抗）');
  check(computeDamage(100, 'physical', 500, 0) === 5, '伤害至少为攻击力的 5%');
  check(computeDamage(100, 'true', 500, 90) === 100, '真实伤害不被减免');
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

  // 治疗：医疗角色治疗受伤的队友
  const medic = charById.get('C006')!;
  const guard = charById.get('C001')!;
  const eng = new GameEngine(lv, [medic, guard], [dummy], { skills });
  eng.deploy('C006', { x: 2, y: 1 });
  eng.deploy('C001', { x: 2, y: 0 });
  const g0 = eng.units.find((u) => u.def.id === 'C001')!;
  g0.hp = 300;
  runSkills(eng, 1);
  check(g0.hp > 300, `医疗（攻击力 ${medic.atk}，攻击队友）治疗了受伤的守卫：300 → ${Math.round(g0.hp)}`);

  // 多目标：目标数 -1 攻击射程内全部敌人
  const gunner = charById.get('C007')!;
  const lv2 = normalizeLevel({ ...lv, lines: [{ id: 'L', name: 't', route: { mode: 'auto', spawn: { x: 0, y: 0 } }, blocks: [{ id: 'b', enemyId: 'D', count: 3, interval: 0.4, startTime: 0 }] }] });
  const eng2 = new GameEngine(lv2, [gunner], [dummy], { skills });
  runSkills(eng2, 1.2);
  eng2.deploy('C007', { x: 1, y: 1 });
  runSkills(eng2, 0.5);
  const hits = eng2.enemies.filter((e) => e.hp < e.stats.maxHp).length;
  check(hits === 3, `炮手（目标数 -1）一次攻击命中了射程内全部 ${hits} 个敌人`);
  check(eng2.enemies.every((e) => e.stats.speed < e.base.speed), '命中附带的减速效果生效');

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
  check(
    auto.status === 'won',
    `${lv.id} 自动部署：${auto.status}，用时 ${auto.time.toFixed(1)}s，击杀 ${auto.killed}，漏怪 ${auto.leaked}，剩余血量 ${auto.hp}/${auto.maxHp}，场上：${used || '无'}`,
  );
  if (auto.warnings.length) console.log('    警告：', auto.warnings.join('；'));
}

console.log(failures ? `\n失败 ${failures} 项` : '\n全部通过');
process.exit(failures ? 1 : 0);
