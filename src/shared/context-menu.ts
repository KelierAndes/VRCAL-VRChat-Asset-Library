// These ids are persisted in settings. Labels may change; ids must stay stable.
const actions = [
  { id: 'details', label: '查看详情' },
  { id: 'model-preview', label: '3D 预览' },
  { id: 'reveal', label: '打开所在文件夹' },
  { id: 'copy-path', label: '复制路径' },
  { id: 'open-source', label: '打开商品页面' },
  { id: 'project-products', label: '读取工程内商品' },
  { id: 'project-files', label: '查看工程文件' },
  { id: 'import-project', label: '导入到工程 / 导入本地素材' },
  { id: 'favorite', label: '收藏 / 取消收藏' },
  { id: 'tags', label: '添加标签' },
  { id: 'category', label: '修改分类' },
  { id: 'relations', label: '关联素材' },
  { id: 'project-in-progress', label: '标记为制作中' },
  { id: 'project-completed', label: '标记为已完成' },
  { id: 'matching-mode', label: '切换自动匹配 / 手动归类' },
  { id: 'collection', label: '加入集合' },
  { id: 'remove-tags', label: '移除标签' },
  { id: 'cover', label: '更换封面 / 添加工程截图' },
  { id: 'force-rematch', label: '强制重新匹配' },
  { id: 'hide', label: '从资料库隐藏' },
  { id: 'delete', label: '删除（移入回收站）' }
] as const;

export const CONTEXT_ACTIONS = Object.freeze(actions.map(action => Object.freeze(action)));

export type ContextActionId = (typeof CONTEXT_ACTIONS)[number]['id'];

export interface ContextMenuPreferences {
  order: ContextActionId[];
  hidden: ContextActionId[];
}

export const DEFAULT_CONTEXT_MENU_PREFERENCES: {
  readonly order: readonly ContextActionId[];
  readonly hidden: readonly ContextActionId[];
} = Object.freeze({
  order: Object.freeze(CONTEXT_ACTIONS.map(action => action.id)),
  hidden: Object.freeze([] as ContextActionId[])
});

const actionIds = new Set<string>(CONTEXT_ACTIONS.map(action => action.id));

function isStringArray(value: unknown): value is string[] {
  // Array.every skips holes, which would allow damaged arrays through strict writes.
  return Array.isArray(value) && [...value].every(item => typeof item === 'string');
}

export function normalizeContextMenuPreferences(value: unknown, strict = false): ContextMenuPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      !('order' in value) || !('hidden' in value) ||
      !isStringArray(value.order) || !isStringArray(value.hidden)) {
    if (strict) throw new TypeError('右键菜单设置无效。');
    return { order: [...DEFAULT_CONTEXT_MENU_PREFERENCES.order], hidden: [] };
  }

  const knownUnique = (ids: string[]): ContextActionId[] =>
    [...new Set(ids)].filter((id): id is ContextActionId => actionIds.has(id));
  const order = knownUnique(value.order);
  const present = new Set(order);
  order.push(...DEFAULT_CONTEXT_MENU_PREFERENCES.order.filter(id => !present.has(id)));
  return { order, hidden: knownUnique(value.hidden) };
}
