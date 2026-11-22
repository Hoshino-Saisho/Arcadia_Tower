/** 关卡编号：章节编号_关卡序号，例如 "ZH_1" */
export function levelCode(chapterId: string, index: number): string {
  return `${chapterId}_${index}`;
}

export function parseLevelCode(code: string): { chapterId: string; index: number } | null {
  const i = code.lastIndexOf('_');
  if (i <= 0) return null;
  const index = Number(code.slice(i + 1));
  if (!Number.isInteger(index) || index < 1) return null;
  return { chapterId: code.slice(0, i), index };
}

/** 角色 / 敌人 ID：字母、数字、下划线、短横线 */
export function validateUnitId(id: string): string | null {
  if (!id) return 'ID 不能为空';
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return 'ID 只能包含字母、数字、下划线和短横线';
  if (id.length > 24) return 'ID 最多 24 个字符';
  return null;
}

/** 章节编号：字母和数字，不能有下划线（下划线用于连接关卡序号） */
export function validateChapterId(id: string): string | null {
  if (!id) return '章节编号不能为空';
  if (!/^[A-Za-z0-9]+$/.test(id)) return '章节编号只能包含字母和数字（不能有下划线）';
  if (id.length > 16) return '章节编号最多 16 个字符';
  return null;
}

/** 生成形如 PREFIX001 的下一个可用 ID */
export function nextId(prefix: string, existing: string[]): string {
  const used = new Set(existing);
  for (let n = 1; n < 100000; n++) {
    const id = `${prefix}${String(n).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}

let uidCounter = 0;
/** 关卡内部对象（敌人线、积木）使用的短随机 ID */
export function shortUid(prefix = ''): string {
  uidCounter = (uidCounter + 1) % 1296;
  return prefix + Date.now().toString(36).slice(-5) + uidCounter.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 5);
}
