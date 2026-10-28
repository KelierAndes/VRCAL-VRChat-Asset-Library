import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DownloadExtractionJob } from '../shared/baidu-download';
import { extractDownloadArchives, supportsDownloadExtraction } from './download-extract';
import { assertSafeWrite, isWithin, writeOwnedAtomic } from './safety';

export interface ExtractionSource { id: string; file: string; name: string }
interface Deps {
  dataDir: string;
  roots: () => string[];
  available: () => boolean;
  changed: () => void;
  register: (directory: string) => Promise<{ assetId: string }>;
  trash?: (file: string) => Promise<void>;
  onRecycled?: (source: ExtractionSource) => void;
}
interface Identity { device: string; inode: string; birthtime: string }
interface FileIdentity extends Identity { size: string; modified: string; changed: string }
interface Input extends ExtractionSource { identity: FileIdentity }
interface StoredJob extends DownloadExtractionJob { parent?: string; directoryIdentity?: Identity }
interface Operation { controller: AbortController; promise: Promise<void> }

const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const UUID_RE = new RegExp('^' + UUID + '$');
const OUTPUT_RE = new RegExp('^.{1,70}--vrcal-unpacked-' + UUID + '$');
const TOKEN_RE = /^[A-Za-z0-9:_-]{1,256}$/;
const DEVICE_RE = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i;
const IDENTITY_KEYS = ['device', 'inode', 'birthtime'] as const;
const FILE_KEYS = [...IDENTITY_KEYS, 'size', 'modified', 'changed'] as const;
const STATES = ['extracting', 'registering', 'completed', 'failed'];
// The extractor allows 50,000 payload paths plus one subtree for each of 100 ZIPs.
const MAX_OUTPUT_PATHS = 50_101;
const now = () => new Date().toISOString();
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
const pathKey = (file: string) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);

function localPath(value: unknown): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /\x00/.test(value) || /^\\\\[?.]\\/.test(value)) throw new Error('解压路径无效。');
  const resolved = path.resolve(value);
  for (const part of resolved.slice(path.parse(resolved).root.length).split(path.sep)) {
    if (!part || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(part) || /[. ]$/.test(part) || DEVICE_RE.test(part)) throw new Error('解压路径包含不安全的名称。');
  }
  return resolved;
}

/** Reading a registered output must remain possible after it becomes a protected root. */
function noLinks(file: string): void {
  for (let current = file;; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('解压路径包含链接，已停止操作。');
    if (current !== file && !stat.isDirectory()) throw new Error('解压目录已发生变化。');
    if (path.dirname(current) === current) break;
  }
}

function identity(stat: fs.BigIntStats): Identity {
  if (stat.ino === 0n || stat.birthtimeNs === 0n) throw new Error('文件系统无法可靠校验解压资源。');
  return { device: stat.dev.toString(), inode: stat.ino.toString(), birthtime: stat.birthtimeNs.toString() };
}

function fileIdentity(file: string): FileIdentity {
  noLinks(file);
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw new Error('原压缩包必须是普通文件，不能包含链接。');
  return { ...identity(stat), size: stat.size.toString(), modified: stat.mtimeNs.toString(), changed: stat.ctimeNs.toString() };
}

function directoryIdentity(directory: string): Identity {
  noLinks(directory);
  const stat = fs.lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('解压目录已发生变化。');
  return identity(stat);
}

function storedIdentity(value: any): Identity | undefined {
  if (!value || typeof value !== 'object' || IDENTITY_KEYS.some(key => typeof value[key] !== 'string' || !/^\d{1,40}$/.test(value[key])) || value.inode === '0' || value.birthtime === '0') return;
  return { device: value.device, inode: value.inode, birthtime: value.birthtime };
}

function archiveName(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 255 || value !== path.basename(value) || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(value) || /[. ]$/.test(value) || DEVICE_RE.test(value)) throw new Error('原压缩包文件名无效。');
  if (!supportsDownloadExtraction(value)) throw new Error('目前仅支持解压 ZIP 压缩包。');
  return value;
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 50 && Number.isFinite(Date.parse(value));
}

/** Hash bounded, deterministic metadata snapshots, without retaining huge trees in memory. */
function payloadSnapshot(directory: string): string {
  noLinks(directory);
  const hash = createHash('sha256'), pending = [''];
  let count = 0;
  while (pending.length) {
    const relative = pending.pop()!, file = path.join(directory, relative);
    if (++count > MAX_OUTPUT_PATHS || relative.length > 8192) throw new Error('解压目录内容超过安全检查上限。');
    const stat = fs.lstatSync(file, { bigint: true });
    if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1n))) throw new Error('解压目录内容出现链接或特殊文件。');
    const owned = identity(stat);
    hash.update(JSON.stringify([relative, stat.isDirectory() ? 'directory' : 'file', owned.device, owned.inode, owned.birthtime, stat.size.toString(), stat.mtimeNs.toString(), stat.ctimeNs.toString()]) + '\n');
    if (stat.isDirectory()) {
      const names = fs.readdirSync(file).sort();
      if (names.length > MAX_OUTPUT_PATHS - count - pending.length) throw new Error('解压目录内容超过安全检查上限。');
      for (let index = names.length - 1; index >= 0; index--) pending.push(path.join(relative, names[index]));
    }
  }
  noLinks(directory);
  return count + ':' + hash.digest('hex');
}

export class DownloadExtractionJobs {
  private jobs: StoredJob[] = [];
  private outputFingerprints = new Map<string, string>();
  private operation?: Operation;
  private closed = false;

  constructor(private readonly deps: Deps) { this.load(); }

  get busy(): boolean { return !!this.operation; }

  state(): DownloadExtractionJob[] {
    return this.jobs.map(({ parent, directoryIdentity, ...job }) => ({ ...job, taskIds: [...job.taskIds], recycledNames: [...job.recycledNames] }));
  }

  async extract(sources: ExtractionSource[], parent: string, label: string, recycle: boolean): Promise<void> {
    this.requireIdle();
    const selected = this.sources(sources), ids = selected.map(source => source.id).sort();
    const previous = this.jobs.find(job => job.state === 'completed' && job.taskIds.length === ids.length && [...job.taskIds].sort().every((id, index) => id === ids[index]));
    if (previous) {
      let existing = false;
      try { this.output(previous); existing = true; } catch { /* Missing output permits an explicit fresh extraction. */ }
      if (existing) {
        try { this.assertPayload(previous); }
        catch (error) {
          previous.message = reason(error) + ' 原压缩包已保留；如需重新解压，请先将现有解压目录移到其他位置后再执行。';
          this.publishLenient(previous); throw new Error(previous.message);
        }
        return;
      }
    }
    const job: StoredJob = { id: randomUUID(), taskIds: selected.map(source => source.id), name: typeof label === 'string' && label.trim() ? label.trim().slice(0, 500) : '下载素材', state: 'extracting', files: 0, bytes: 0, recycledNames: [], message: '正在解压 ZIP…', startedAt: now() };
    this.jobs.unshift(job); this.jobs = this.jobs.slice(0, 200);
    const retained = new Set(this.jobs.map(candidate => candidate.id));
    for (const id of this.outputFingerprints.keys()) if (!retained.has(id)) this.outputFingerprints.delete(id);
    await this.run(job, async controller => {
      this.publish(); this.assertAvailable(controller);
      job.parent = this.destination(parent);
      const inputs: Input[] = selected.map(source => { this.sourcePath(source.file); return { ...source, identity: fileIdentity(source.file) }; });
      const result = await extractDownloadArchives(inputs.map(source => source.file), job.parent, job.name, {
        signal: controller.signal,
        assertAvailable: () => { this.assertAvailable(controller); this.destination(job.parent!); for (const source of inputs) this.sourcePath(source.file); },
      });
      job.directory = this.outputPath(result.directory, job.parent);
      job.directoryIdentity = directoryIdentity(job.directory);
      job.files = result.files; job.bytes = result.bytes;
      this.assertAvailable(controller); this.assertInputs(inputs);
      this.outputFingerprints.set(job.id, payloadSnapshot(this.output(job)));
      await this.register(job, controller);
      job.state = 'completed'; job.finishedAt = now(); job.message = '解压并入库完成，原压缩包已保留。';
      // A completed result must be durable before the first optional destructive action.
      this.publish();
      if (recycle) await this.recycle(job, inputs, controller);
    });
  }

  async retryImport(id: string): Promise<void> {
    this.requireIdle();
    const job = this.jobs.find(candidate => candidate.id === id);
    if (!job) throw new Error('请选择已有的解压任务。');
    if (job.state === 'completed') { this.output(job); return; }
    this.output(job);
    await this.run(job, async controller => {
      this.assertAvailable(controller);
      this.outputFingerprints.set(job.id, payloadSnapshot(this.output(job)));
      await this.register(job, controller);
      job.state = 'completed'; job.finishedAt = now();
      job.message = '解压目录已重新入库；重试入库不会回收原压缩包。';
      this.publish();
    });
  }

  reveal(id: string): string {
    const job = this.jobs.find(candidate => candidate.id === id);
    if (!job) throw new Error('请选择已有的解压任务。');
    return this.output(job);
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    const active = this.operation;
    if (active) { active.controller.abort(new Error('已取消解压，应用正在停止。')); await active.promise.catch(() => {}); }
  }

  private requireIdle(): void {
    if (this.closed) throw new Error('解压服务已经关闭。');
    if (this.busy) throw new Error('请等待当前解压或入库完成。');
  }

  private assertAvailable(controller: AbortController): void {
    if (controller.signal.aborted || this.closed) throw new Error('已取消解压，应用正在停止。');
    if (!this.deps.available()) throw new Error('资料库已变化或暂不可用，已停止解压。');
  }

  private sources(value: ExtractionSource[]): ExtractionSource[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new Error('请选择 1 至 100 个 ZIP 压缩包。');
    const seen = new Set<string>(), paths = new Set<string>();
    return value.map(source => {
      if (!source || typeof source.id !== 'string' || !TOKEN_RE.test(source.id) || seen.has(source.id)) throw new Error('解压任务编号无效或重复。');
      seen.add(source.id);
      const file = localPath(source.file), name = archiveName(source.name);
      if (path.basename(file) !== name || paths.has(pathKey(file))) throw new Error('原压缩包路径重复或文件名已变化。');
      paths.add(pathKey(file)); return { id: source.id, file, name };
    });
  }

  private sourcePath(file: string): string {
    return assertSafeWrite(localPath(file), this.deps.dataDir, [...this.deps.roots(), this.deps.dataDir], true);
  }

  private destination(value: string): string {
    const directory = assertSafeWrite(localPath(value), this.deps.dataDir, [...this.deps.roots(), this.deps.dataDir], true);
    noLinks(directory);
    if (!fs.lstatSync(directory).isDirectory()) throw new Error('请选择普通解压目录。');
    return directory;
  }

  private outputPath(value: string, parent: string): string {
    const directory = localPath(value), anchor = localPath(parent);
    if (isWithin(directory, this.deps.dataDir) || pathKey(path.dirname(directory)) !== pathKey(anchor) || !OUTPUT_RE.test(path.basename(directory))) throw new Error('解压目录记录无效。');
    return directory;
  }

  private output(job: StoredJob): string {
    if (!job.directory || !job.parent || !job.directoryIdentity) throw new Error('此任务没有可安全使用的解压目录，请重新解压。');
    const directory = this.outputPath(job.directory, job.parent), current = directoryIdentity(directory);
    if (IDENTITY_KEYS.some(key => current[key] !== job.directoryIdentity![key])) throw new Error('解压目录已发生变化，已停止操作。');
    return directory;
  }

  private assertInputs(inputs: Input[]): void {
    for (const source of inputs) {
      this.sourcePath(source.file);
      const current = fileIdentity(source.file);
      if (FILE_KEYS.some(key => current[key] !== source.identity[key])) throw new Error('原压缩包已发生变化，已保留原文件。');
    }
  }

  private assertPayload(job: StoredJob): void {
    const directory = this.output(job), expected = this.outputFingerprints.get(job.id);
    // Restarted jobs have no in-memory payload baseline, and are never allowed to recycle.
    if (expected !== undefined && payloadSnapshot(directory) !== expected) throw new Error('解压目录内容已发生变化，已停止操作。');
    this.output(job);
  }

  private async register(job: StoredJob, controller: AbortController): Promise<void> {
    this.assertAvailable(controller); this.output(job);
    job.state = 'registering'; job.message = '解压完成，正在入库…'; delete job.finishedAt;
    this.publish(); this.assertAvailable(controller);
    const result = await this.deps.register(this.output(job));
    this.assertAvailable(controller); this.assertPayload(job);
    if (!result || typeof result.assetId !== 'string' || !TOKEN_RE.test(result.assetId)) throw new Error('素材入库没有返回有效的素材编号。');
    job.assetId = result.assetId;
  }

  private async recycle(job: StoredJob, inputs: Input[], controller: AbortController): Promise<void> {
    try {
      if (!this.deps.trash) throw new Error('回收站暂不可用，原压缩包已保留。');
      for (let index = 0; index < inputs.length; index++) {
        this.assertAvailable(controller); this.assertPayload(job); this.assertInputs(inputs.slice(index));
        const source = inputs[index];
        await this.deps.trash(source.file);
        job.recycledNames.push(source.name);
        this.deps.onRecycled?.({ id: source.id, file: source.file, name: source.name });
        this.publish();
      }
      job.message = '解压并入库完成，原压缩包已移入回收站。';
    } catch (error) {
      job.message = '解压并入库完成；部分原压缩包未能回收：' + reason(error);
    }
    this.publishLenient(job);
  }

  private async run(job: StoredJob, action: (controller: AbortController) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    const promise = Promise.resolve().then(async () => {
      try { await action(controller); }
      catch (error) {
        job.state = 'failed'; job.finishedAt = now(); job.message = reason(error) + (job.directory ? ' 解压目录已保留，可重试入库；原压缩包未自动回收。' : ' 原压缩包未自动回收。');
        this.publishLenient(job); throw error;
      }
    });
    const active = this.operation = { controller, promise };
    try { await promise; }
    finally { if (this.operation === active) this.operation = undefined; this.notify(); }
  }

  private journal(): string { return assertSafeWrite(path.join(this.deps.dataDir, 'download-extractions.json'), this.deps.dataDir, this.deps.roots()); }
  private notify(): void { try { this.deps.changed(); } catch { /* A UI listener cannot alter filesystem outcomes. */ } }
  private publish(): void { writeOwnedAtomic(this.journal(), JSON.stringify({ schema: 1, jobs: this.jobs }), this.deps.dataDir, this.deps.roots()); this.notify(); }
  private publishLenient(job: StoredJob): void {
    try { this.publish(); }
    catch { job.message += ' 解压记录保存失败，请检查资料库磁盘。'; this.notify(); }
  }

  private load(): void {
    try {
      const file = this.journal(); noLinks(file);
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) return;
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (value?.schema !== 1 || !Array.isArray(value.jobs)) return;
      const seen = new Set<string>(); let interrupted = false;
      this.jobs = value.jobs.slice(0, 200).flatMap((record: any) => {
        try {
          if (!record || !UUID_RE.test(record.id) || seen.has(record.id) || !Array.isArray(record.taskIds) || record.taskIds.length < 1 || record.taskIds.length > 100 || record.taskIds.some((id: any) => typeof id !== 'string' || !TOKEN_RE.test(id)) || new Set(record.taskIds).size !== record.taskIds.length || !STATES.includes(record.state) || !validTime(record.startedAt)) return [];
          const job: StoredJob = { id: record.id, taskIds: [...record.taskIds], name: typeof record.name === 'string' ? record.name.slice(0, 500) : '下载素材', state: record.state, files: Number.isSafeInteger(record.files) && record.files >= 0 ? record.files : 0, bytes: Number.isSafeInteger(record.bytes) && record.bytes >= 0 ? record.bytes : 0, recycledNames: [], message: typeof record.message === 'string' ? record.message.slice(0, 4000) : '', startedAt: record.startedAt };
          if (validTime(record.finishedAt)) job.finishedAt = record.finishedAt;
          if (typeof record.assetId === 'string' && TOKEN_RE.test(record.assetId)) job.assetId = record.assetId;
          if (Array.isArray(record.recycledNames)) job.recycledNames = record.recycledNames.slice(0, 100).map(archiveName);
          const owned = storedIdentity(record.directoryIdentity);
          if (owned && typeof record.parent === 'string' && typeof record.directory === 'string') {
            job.directory = this.outputPath(record.directory, record.parent); job.parent = localPath(record.parent); job.directoryIdentity = owned;
          }
          if (job.state === 'extracting' || job.state === 'registering' || job.state === 'completed' && (!job.directory || !job.assetId)) {
            job.state = 'failed'; job.finishedAt = now(); job.message = '上次解压或入库已中断；可重试入库，原压缩包不会自动回收。'; interrupted = true;
          }
          seen.add(job.id); return [job];
        } catch { return []; }
      });
      if (interrupted) try { this.publish(); } catch { /* Loading never starts work or manipulates archive files. */ }
    } catch { /* Missing or malformed journals grant no path authority. */ }
  }
}
