import type { AppLanguage } from './contracts';

// These are complete, literal service prefixes. The remaining text is a path,
// not a translation template or another message to interpret recursively.
const PATH_MESSAGES: Record<string, readonly [string, string]> = {
  '路径包含文件或目录链接，不能移入回收站：': [
    'The path contains a file or directory link and cannot be moved to the Recycle Bin: ',
    'ファイルまたはフォルダーへのリンクを含むため、ゴミ箱に移動できません：'
  ],
  '只能将普通文件或文件夹移入回收站：': [
    'Only regular files or folders can be moved to the Recycle Bin: ',
    '通常のファイルまたはフォルダーのみゴミ箱に移動できます：'
  ],
  '素材祖先路径不是普通文件夹：': [
    'An ancestor of the material path is not a regular folder: ',
    '素材パスの上位に通常のフォルダーではない項目があります：'
  ],
  'Unity 工程及其内部文件受保护：': [
    'The Unity project and its contents are protected: ',
    'Unity プロジェクトとその内部ファイルは保護されています：'
  ],
  '待回收文件夹包含 Unity 工程，已保护整个文件夹：': [
    'The folder contains a Unity project; the entire folder is protected: ',
    'フォルダーに Unity プロジェクトが含まれるため、フォルダー全体を保護しました：'
  ],
  '素材子目录包含目录链接：': [
    'A material subfolder contains a directory link: ',
    '素材のサブフォルダーにフォルダーへのリンクが含まれています：'
  ],
  '素材文件夹在检查期间已变化：': [
    'The material folder changed during inspection: ',
    '確認中に素材フォルダーが変更されました：'
  ]
};

export const RECYCLE_MESSAGES: Record<string, readonly [string, string]> = {
  '扫描与补全只读': ['Scanning and enrichment are read-only', 'スキャンと補完は読み取り専用'],
  '关闭': ['Close', '閉じる'],
  ...PATH_MESSAGES,
  '删除素材': ['Delete material', '素材を削除'],
  '删除（移入回收站）': ['Delete (move to Recycle Bin)', '削除（ゴミ箱へ移動）'],
  '批量删除（移入回收站）': ['Delete selected (move to Recycle Bin)', '選択項目を削除（ゴミ箱へ移動）'],
  '删除素材（移入回收站）': ['Delete materials (move to Recycle Bin)', '素材を削除（ゴミ箱へ移動）'],
  '移入回收站': ['Move to Recycle Bin', 'ゴミ箱へ移動'],
  '批量隐藏': ['Hide selected', '選択項目を非表示'],
  '从资料库隐藏': ['Hide from library', 'ライブラリから非表示'],
  '已从资料库隐藏，可在设置中恢复': ['Hidden from library. Restore in Settings.', '非表示にしました。設定から再表示できます。'],
  '设置右键菜单': ['Customize context menu', '右クリックメニューを設定'],
  '选择本页素材': ['Select materials on this page', 'このページの素材を選択'],
  '选择素材：{name}': ['Select material: {name}', '素材を選択：{name}'],
  '回收站处理结果': ['Recycle Bin results', 'ゴミ箱への移動結果'],
  '已移入回收站': ['Moved to Recycle Bin', 'ゴミ箱へ移動済み'],
  '未能移入回收站': ['Could not move to Recycle Bin', 'ゴミ箱へ移動できませんでした'],
  '未处理': ['Not processed', '未処理'],
  '已移入回收站 {done} 项，失败 {failed} 项，未处理 {skipped} 项': [
    'Moved to Recycle Bin: {done}; failed: {failed}; not processed: {skipped}',
    'ゴミ箱へ移動：{done} 件、失敗：{failed} 件、未処理：{skipped} 件'
  ],
  '可在 Windows 回收站还原文件，然后刷新素材。原有封面和标注仍保留。': [
    'You can restore files from the Windows Recycle Bin, then refresh materials. Existing covers and annotations are retained.',
    'Windows のゴミ箱からファイルを復元した後、素材を更新できます。既存の表紙と注釈は保持されます。'
  ],
  '以下路径将移入系统回收站。文件夹包含的文件也会一并处理；隐藏不会执行此操作。': [
    'The following paths will be moved to the system Recycle Bin, including all files inside selected folders. Hiding materials does not move files.',
    '次のパスをシステムのゴミ箱に移動します。選択したフォルダー内のファイルも対象です。非表示の操作ではファイルは移動しません。'
  ],
  '可在 Windows 回收站还原文件，然后刷新素材。不会永久删除，也不会删除 Unity 工程。': [
    'You can restore files from the Windows Recycle Bin, then refresh materials. Files will not be permanently deleted, and Unity projects will not be deleted.',
    'Windows のゴミ箱からファイルを復元した後、素材を更新できます。完全な削除は行わず、Unity プロジェクトも削除しません。'
  ],
  '将 {count} 个路径移入系统回收站？': [
    'Move {count} paths to the system Recycle Bin?',
    '{count} 件のパスをシステムのゴミ箱に移動しますか？'
  ],
  '文件已移入回收站，但资料库记录未能更新，请重新读取资料库后刷新。': [
    'Files were moved to the Recycle Bin, but the library records could not be updated. Reload the library, then refresh.',
    'ファイルをゴミ箱に移動しましたが、ライブラリの記録を更新できませんでした。ライブラリを読み込み直してから更新してください。'
  ],
  '正在处理回收站操作，请稍候。': ['A Recycle Bin operation is in progress. Please wait.', 'ゴミ箱への移動を処理中です。しばらくお待ちください。'],
  '待确认路径过多，请分批选择后删除。': ['Too many paths to confirm. Select and delete them in smaller batches.', '確認するパスが多すぎます。少しずつ選択して削除してください。'],
  '资料库状态已变化，请重新选择素材。': ['The library state has changed. Select the materials again.', 'ライブラリの状態が変わりました。素材を選択し直してください。'],
  '素材路径必须是本机普通文件或文件夹的绝对路径。': ['The material path must be an absolute path to a regular local file or folder.', '素材には、この PC 上の通常のファイルまたはフォルダーの絶対パスを指定してください。'],
  '磁盘根目录受保护，不能移入回收站。': ['Drive root directories are protected and cannot be moved to the Recycle Bin.', 'ドライブのルートフォルダーは保護されているため、ゴミ箱に移動できません。'],
  '资料库及其祖先、缓存和会话目录受保护，不能移入回收站。': [
    'The library, its ancestor folders, caches and session folders are protected and cannot be moved to the Recycle Bin.',
    'ライブラリとその上位フォルダー、キャッシュ、セッションフォルダーは保護されているため、ゴミ箱に移動できません。'
  ],
  '固定保护目录及其祖先不能移入回收站，手动素材根例外不适用。': [
    'Protected folders and their ancestors cannot be moved to the Recycle Bin. The exception for manually added material roots does not apply.',
    '固定の保護フォルダーとその上位フォルダーはゴミ箱に移動できません。手動追加した素材ルートの例外は適用されません。'
  ],
  '素材根目录及其祖先受保护，不能移入回收站。': ['Material root folders and their ancestors are protected and cannot be moved to the Recycle Bin.', '素材のルートフォルダーとその上位フォルダーは保護されているため、ゴミ箱に移動できません。'],
  '素材已脱离已登记的扫描或下载范围。': ['The material is outside the registered scan or download scope.', '素材が登録済みのスキャンまたはダウンロードの範囲外にあります。'],
  'Unity 工程及其祖先和内部文件受保护，不能移入回收站。': ['Unity projects, their ancestor folders and their contents are protected and cannot be moved to the Recycle Bin.', 'Unity プロジェクトとその上位フォルダー、内部ファイルは保護されているため、ゴミ箱に移動できません。'],
  '素材真实路径与登记路径不一致，可能包含目录链接。': ['The material\'s real path differs from its registered path and may contain a directory link.', '素材の実際のパスが登録済みのパスと異なります。フォルダーへのリンクが含まれている可能性があります。'],
  '素材或目录身份已变化，请重新选择并确认回收站操作。': ['The material or folder identity has changed. Select it again and confirm the Recycle Bin operation.', '素材またはフォルダーの識別情報が変わりました。選択し直し、ゴミ箱への移動を再確認してください。'],
  '素材文件或文件夹类型已变化，请重新确认。': ['The material\'s file or folder type has changed. Confirm again.', '素材のファイルまたはフォルダーの種類が変わりました。再確認してください。'],
  '素材在检查期间已变化，请重新确认。': ['The material changed during inspection. Confirm again.', '確認中に素材が変更されました。再確認してください。'],
  '回收站检查规模上限无效。': ['Invalid Recycle Bin inspection limit.', 'ゴミ箱への移動前の確認上限が無効です。'],
  '请选择 1 至 1000 个已登记素材。': ['Select between 1 and 1000 registered materials.', '登録済みの素材を 1～1000 件選択してください。'],
  '素材登记记录无效或 ID 重复。': ['The material registration record is invalid or contains a duplicate ID.', '素材の登録記録が無効か、ID が重複しています。'],
  '所选素材尚未登记或已不在资料库中。': ['A selected material is not registered or is no longer in the library.', '選択した素材が未登録か、ライブラリに存在しなくなっています。'],
  'Unity 工程不能通过素材回收站操作删除。': ['Unity projects cannot be deleted through the material Recycle Bin action.', '素材のゴミ箱への移動操作では Unity プロジェクトを削除できません。'],
  '回收站计划无效或已经执行，请重新准备并确认。': ['The Recycle Bin plan is invalid or has already run. Prepare and confirm it again.', 'ゴミ箱への移動計画が無効か、既に実行済みです。準備して再確認してください。'],
  '缺少系统回收站适配器。': ['The system Recycle Bin adapter is unavailable.', 'システムのゴミ箱への移動機能が利用できません。'],
  '待回收文件夹超过检查规模上限（{count} 项），请缩小选择范围。': ['The folder exceeds the inspection limit ({count} entries). Select fewer materials.', 'フォルダーが確認上限（{count} 件）を超えています。選択範囲を狭めてください。'],
  '待回收文件夹超过目录深度上限（{depth} 层），请缩小选择范围。': ['The folder exceeds the directory depth limit ({depth} levels). Select fewer materials.', 'フォルダーが階層の深さの上限（{depth} 階層）を超えています。選択範囲を狭めてください。'],
  '回收站计划超过检查规模上限（{count} 项），请缩小选择范围。': ['The Recycle Bin plan exceeds the inspection limit ({count} entries). Select fewer materials.', 'ゴミ箱への移動計画が確認上限（{count} 件）を超えています。選択範囲を狭めてください。'],
  // Production currently uses these fixed limits. Other dynamic numbers are not
  // interpreted by the deliberately narrow path-error translator below.
  '待回收文件夹超过检查规模上限（100000 项），请缩小选择范围。': ['The folder exceeds the inspection limit (100000 entries). Select fewer materials.', 'フォルダーが確認上限（100000 件）を超えています。選択範囲を狭めてください。'],
  '待回收文件夹超过目录深度上限（64 层），请缩小选择范围。': ['The folder exceeds the directory depth limit (64 levels). Select fewer materials.', 'フォルダーが階層の深さの上限（64 階層）を超えています。選択範囲を狭めてください。'],
  '回收站计划超过检查规模上限（100000 项），请缩小选择范围。': ['The Recycle Bin plan exceeds the inspection limit (100000 entries). Select fewer materials.', 'ゴミ箱への移動計画が確認上限（100000 件）を超えています。選択範囲を狭めてください。']
};

/** Translate only known service prefixes followed by a literal absolute path. */
export function translateRecycleMessage(source: string, language: AppLanguage): string | undefined {
  if (source.length > 8192) return undefined;
  for (const [prefix, translations] of Object.entries(PATH_MESSAGES)) {
    if (!source.startsWith(prefix)) continue;
    const file = source.slice(prefix.length);
    if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(file)) return undefined;
    if (language === 'zh-CN') return source;
    return translations[language === 'en' ? 0 : 1] + file;
  }
  return undefined;
}
