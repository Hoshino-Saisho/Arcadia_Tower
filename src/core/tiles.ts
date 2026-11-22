import type { GridPos, LevelDef, PlacementType, TileType } from './types';

/**
 * 方块注册表：新增方块类型只需要在这里登记一条即可，
 * 地图编辑器的积木面板、寻路、部署判定、渲染都会读取这里的属性。
 */
export interface TileInfo {
  type: TileType;
  /** 存档中的单字符编码 */
  code: string;
  label: string;
  /** 编辑器 / 游戏中的底色 */
  color: string;
  /** 敌人能否行走 */
  walkable: boolean;
  /** 可部署的角色类型：ground = 地面角色，high = 高台角色，null = 不可部署 */
  deploy: 'ground' | 'high' | null;
  /** 编辑器快捷键 */
  hotkey: string;
  hint: string;
}

export const TILE_TYPES: TileInfo[] = [
  {
    type: 'ground',
    code: 'G',
    label: '地面',
    color: '#5b6472',
    walkable: true,
    deploy: 'ground',
    hotkey: '1',
    hint: '敌人可行走，可部署地面角色',
  },
  {
    type: 'high',
    code: 'H',
    label: '高台',
    color: '#8c7b58',
    walkable: false,
    deploy: 'high',
    hotkey: '2',
    hint: '敌人不可行走，可部署高台角色',
  },
  {
    type: 'spawn',
    code: 'S',
    label: '敌人出现点',
    color: '#b8433f',
    walkable: true,
    deploy: null,
    hotkey: '3',
    hint: '敌人从这里出现',
  },
  {
    type: 'base',
    code: 'B',
    label: '敌人目的地（基地）',
    color: '#2f6fb3',
    walkable: true,
    deploy: null,
    hotkey: '4',
    hint: '敌人中心到达基地中心时扣 1 点血量',
  },
  {
    type: 'nodeploy',
    code: 'X',
    label: '不可放置',
    color: '#3c4049',
    walkable: true,
    deploy: null,
    hotkey: '5',
    hint: '敌人可行走，但不能放置角色',
  },
];

export const EMPTY_CODE = '.';

const BY_CODE = new Map(TILE_TYPES.map((t) => [t.code, t]));
const BY_TYPE = new Map(TILE_TYPES.map((t) => [t.type, t]));

export function tileInfo(type: TileType): TileInfo {
  return BY_TYPE.get(type)!;
}

export function tileFromCode(code: string): TileInfo | null {
  return BY_CODE.get(code) ?? null;
}

/** 方便运行时查询的网格视图 */
export class TileGrid {
  readonly width: number;
  readonly height: number;
  private cells: (TileInfo | null)[];

  constructor(width: number, height: number, rows: string[]) {
    this.width = width;
    this.height = height;
    this.cells = new Array(width * height).fill(null);
    for (let y = 0; y < height; y++) {
      const row = rows[y] ?? '';
      for (let x = 0; x < width; x++) {
        this.cells[y * width + x] = tileFromCode(row[x] ?? EMPTY_CODE);
      }
    }
  }

  static fromLevel(level: LevelDef): TileGrid {
    return new TileGrid(level.width, level.height, level.grid);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): TileInfo | null {
    if (!this.inBounds(x, y)) return null;
    return this.cells[y * this.width + x];
  }

  isWalkable(x: number, y: number): boolean {
    return !!this.get(x, y)?.walkable;
  }

  isType(x: number, y: number, type: TileType): boolean {
    return this.get(x, y)?.type === type;
  }

  /** 找出某种方块的全部坐标 */
  find(type: TileType): GridPos[] {
    const out: GridPos[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y * this.width + x]?.type === type) out.push({ x, y });
      }
    }
    return out;
  }

  /** 非空方块的包围盒（用于游戏中居中显示不规则地图） */
  bounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[y * this.width + x]) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }

  /** 角色能否放在这个方块上（不考虑是否已被占用） */
  canPlace(x: number, y: number, placement: PlacementType): boolean {
    const t = this.get(x, y);
    if (!t || !t.deploy) return false;
    return placement === 'any' || placement === t.deploy;
  }
}

/* ---------- 编辑器用的网格读写工具 ---------- */

export function makeEmptyGrid(width: number, height: number): string[] {
  return Array.from({ length: height }, () => EMPTY_CODE.repeat(width));
}

export function getCode(grid: string[], x: number, y: number): string {
  return grid[y]?.[x] ?? EMPTY_CODE;
}

export function setCode(grid: string[], x: number, y: number, code: string): string[] {
  const row = grid[y];
  if (row === undefined || x < 0 || x >= row.length) return grid;
  if (row[x] === code) return grid;
  const next = grid.slice();
  next[y] = row.slice(0, x) + code + row.slice(x + 1);
  return next;
}

/** 改变网格尺寸（左上角对齐，保留已有方块） */
export function resizeGrid(grid: string[], width: number, height: number): string[] {
  return Array.from({ length: height }, (_, y) => {
    const row = grid[y] ?? '';
    return (row + EMPTY_CODE.repeat(width)).slice(0, width);
  });
}

/** 整体平移地图（超出边界的方块会被丢弃） */
export function shiftGrid(grid: string[], dx: number, dy: number): string[] {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  return Array.from({ length: height }, (_, y) => {
    let row = '';
    for (let x = 0; x < width; x++) row += getCode(grid, x - dx, y - dy);
    return row;
  });
}

export function samePos(a: GridPos | null | undefined, b: GridPos | null | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

export function posKey(p: GridPos): string {
  return `${p.x},${p.y}`;
}

export function formatPos(p: GridPos | null | undefined): string {
  return p ? `(${p.x},${p.y})` : '—';
}
