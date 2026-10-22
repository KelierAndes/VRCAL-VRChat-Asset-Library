'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

// Read the implementation directly: no build and no writes to dist or a library.
const sourcePath = path.resolve(__dirname, '../src/shared/messages-recycle.ts');
const subject = (() => {
  if (!fs.existsSync(sourcePath)) return {};
  const loaded = new Module(sourcePath, module);
  loaded.filename = sourcePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
  loaded._compile(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, sourcePath);
  return loaded.exports;
})();

function translate(source, language) {
  assert.equal(typeof subject.translateRecycleMessage, 'function',
    'recycle messages must expose the bounded path-message translator');
  return subject.translateRecycleMessage(source, language);
}

const pathPrefixes = [
  ['路径包含文件或目录链接，不能移入回收站：', 'The path contains a file or directory link and cannot be moved to the Recycle Bin: ', 'ファイルまたはフォルダーへのリンクを含むため、ゴミ箱に移動できません：'],
  ['只能将普通文件或文件夹移入回收站：', 'Only regular files or folders can be moved to the Recycle Bin: ', '通常のファイルまたはフォルダーのみゴミ箱に移動できます：'],
  ['素材祖先路径不是普通文件夹：', 'An ancestor of the material path is not a regular folder: ', '素材パスの上位に通常のフォルダーではない項目があります：'],
  ['Unity 工程及其内部文件受保护：', 'The Unity project and its contents are protected: ', 'Unity プロジェクトとその内部ファイルは保護されています：'],
  ['待回收文件夹包含 Unity 工程，已保护整个文件夹：', 'The folder contains a Unity project; the entire folder is protected: ', 'フォルダーに Unity プロジェクトが含まれるため、フォルダー全体を保護しました：'],
  ['素材子目录包含目录链接：', 'A material subfolder contains a directory link: ', '素材のサブフォルダーにフォルダーへのリンクが含まれています：'],
  ['素材文件夹在检查期间已变化：', 'The material folder changed during inspection: ', '確認中に素材フォルダーが変更されました：']
];
const specialPath = 'E:\\素材\\{path}\\$& $1 $$ 中文 日本語\\avatar.unitypackage';

test('recognized recycle path errors remain exactly unchanged in Chinese', () => {
  for (const [prefix] of pathPrefixes) {
    const source = prefix + specialPath;
    assert.equal(translate(source, 'zh-CN'), source);
  }
});

test('English and Japanese path errors preserve braces, dollars, Unicode and separators literally', () => {
  for (const [prefix, english, japanese] of pathPrefixes) {
    assert.equal(translate(prefix + specialPath, 'en'), english + specialPath);
    assert.equal(translate(prefix + specialPath, 'ja'), japanese + specialPath);
  }
});

test('the path translator also preserves a POSIX absolute path', () => {
  const file = '/tmp/素材/{name}/$1.unitypackage';
  assert.equal(translate('只能将普通文件或文件夹移入回收站：' + file, 'en'),
    'Only regular files or folders can be moved to the Recycle Bin: ' + file);
});

test('unknown text, ordinary static messages and incomplete prefixes are left to other translators', () => {
  const unknown = [
    '未知错误：' + specialPath, '移入回收站', '没有待确认的候选',
    '前置文本：路径包含文件或目录链接，不能移入回收站：' + specialPath,
    '路径包含文件或目录链接，不能移入回收站：',
    '路径包含文件或目录链接，不能移入回收站：这是一段说明',
    '路径包含文件或目录链接，不能移入回收站：relative/path',
    '待回收文件夹超过检查规模上限（123 项），请缩小选择范围。'
  ];
  for (const source of unknown) for (const language of ['zh-CN', 'en', 'ja']) {
    assert.equal(translate(source, language), undefined);
  }
});

test('dynamic recycle errors have an 8192-character bound without truncating accepted paths', () => {
  const prefix = '素材子目录包含目录链接：';
  const file = 'C:\\' + 'x'.repeat(8192 - prefix.length - 3);
  assert.equal(translate(prefix + file, 'en'), 'A material subfolder contains a directory link: ' + file);
  assert.equal(translate(prefix + file + 'x', 'en'), undefined);
});

const criticalStatic = [
  '删除素材', '删除（移入回收站）', '批量删除（移入回收站）', '删除素材（移入回收站）',
  '移入回收站', '批量隐藏', '从资料库隐藏', '设置右键菜单', '选择本页素材', '选择素材：{name}',
  '回收站处理结果', '已移入回收站', '未能移入回收站', '未处理',
  '已移入回收站 {done} 项，失败 {failed} 项，未处理 {skipped} 项',
  '可在 Windows 回收站还原文件，然后刷新素材。原有封面和标注仍保留。',
  '以下路径将移入系统回收站。文件夹包含的文件也会一并处理；隐藏不会执行此操作。',
  '可在 Windows 回收站还原文件，然后刷新素材。不会永久删除，也不会删除 Unity 工程。',
  '将 {count} 个路径移入系统回收站？',
  '文件已移入回收站，但资料库记录未能更新，请重新读取资料库后刷新。',
  '正在处理回收站操作，请稍候。', '待确认路径过多，请分批选择后删除。', '资料库状态已变化，请重新选择素材。',
  '素材路径必须是本机普通文件或文件夹的绝对路径。', '磁盘根目录受保护，不能移入回收站。',
  '资料库及其祖先、缓存和会话目录受保护，不能移入回收站。',
  '固定保护目录及其祖先不能移入回收站，手动素材根例外不适用。',
  '素材根目录及其祖先受保护，不能移入回收站。', '素材已脱离已登记的扫描或下载范围。',
  'Unity 工程及其祖先和内部文件受保护，不能移入回收站。',
  '素材真实路径与登记路径不一致，可能包含目录链接。',
  '素材或目录身份已变化，请重新选择并确认回收站操作。', '素材文件或文件夹类型已变化，请重新确认。',
  '素材在检查期间已变化，请重新确认。', '回收站检查规模上限无效。', '请选择 1 至 1000 个已登记素材。',
  '素材登记记录无效或 ID 重复。', '所选素材尚未登记或已不在资料库中。',
  'Unity 工程不能通过素材回收站操作删除。', '回收站计划无效或已经执行，请重新准备并确认。', '缺少系统回收站适配器。',
  '待回收文件夹超过检查规模上限（100000 项），请缩小选择范围。',
  '待回收文件夹超过目录深度上限（64 层），请缩小选择范围。',
  '回收站计划超过检查规模上限（100000 项），请缩小选择范围。'
];

test('critical recycle controls, confirmation copy and safety errors all have English and Japanese entries', () => {
  assert.equal(typeof subject.RECYCLE_MESSAGES, 'object', 'the static recycle dictionary is exported');
  for (const source of criticalStatic) {
    const entry = subject.RECYCLE_MESSAGES[source];
    assert.ok(Array.isArray(entry), 'missing recycle translation: ' + source);
    assert.equal(entry.length, 2);
    for (const localized of entry) {
      assert.equal(typeof localized, 'string');
      assert.ok(localized.length > 0);
      assert.notEqual(localized, source);
    }
    const placeholders = source.match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) || [];
    for (const placeholder of placeholders) {
      assert.ok(entry.every(localized => localized.includes(placeholder)), 'missing placeholder ' + placeholder);
    }
  }
});
