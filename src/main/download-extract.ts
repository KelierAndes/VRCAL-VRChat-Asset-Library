import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { Readable, Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as yauzl from 'yauzl';

export interface DownloadExtractionOptions {
  signal?: AbortSignal;
  /** Bounds ZIP entries and created payload paths, including implicit directories. */
  maxFiles?: number;
  maxBytes?: number;
  maxTimeMs?: number;
  assertAvailable?: () => void;
}

interface Identity { dev: bigint; ino: bigint; birthtimeNs: bigint }
interface Source { file: string; stat: fs.BigIntStats }
interface Owned { file: string; identity: Identity; directory: boolean }

const DEFAULT_MAX_ENTRIES = 50_000;
const DEFAULT_MAX_BYTES = 20 * 1024 ** 3;
const DEFAULT_MAX_TIME = 10 * 60 * 1000;
const DEVICE = /^(?:CON|PRN|AUX|NUL|CLOCK\$|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i;
const INVALID_COMPONENT = /[\\/:*?"<>|\x00-\x1f\x7f]/;
const key = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

export function supportsDownloadExtraction(name: string): boolean {
  return typeof name === 'string' && /\.zip$/i.test(name);
}

function sameIdentity(a: Identity, b: Identity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}

function safeLabel(value: string): string {
  let label = String(value || '下载').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').trim().slice(0, 70).replace(/[. ]+$/g, '');
  if (!label || label === '.' || label === '..') label = '下载';
  if (DEVICE.test(label)) label = '_' + label;
  return label;
}

function ordinaryFile(stat: fs.BigIntStats): boolean {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n;
}

function absolutePath(value: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /\x00/.test(value) || /^\\\\[?.]\\/.test(value)) {
    throw new Error('解压路径无效，请选择普通文件和文件夹。');
  }
  const resolved = path.resolve(value);
  // Reject alternate streams, Windows device aliases and ambiguous trailing dots/spaces.
  for (const part of resolved.slice(path.parse(resolved).root.length).split(path.sep)) {
    if (!part || INVALID_COMPONENT.test(part) || /[. ]$/.test(part) || DEVICE.test(part)) {
      throw new Error('解压路径包含不安全的文件名。');
    }
  }
  return resolved;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('解压数量、体积和时间上限必须是正整数。');
  return value;
}

/**
 * Extracts untrusted ZIP downloads into a newly owned directory. Never changes sources
 * or adopts existing output. Cleanup uses recorded identities and nonrecursive removal.
 * The caller owns source authorization, library-session policy and any later recycling.
 */
export async function extractDownloadArchives(
  sources: string[], parent: string, label: string, options: DownloadExtractionOptions = {},
): Promise<{ directory: string; files: number; bytes: number }> {
  const maxFiles = positiveLimit(options.maxFiles, DEFAULT_MAX_ENTRIES);
  const maxBytes = positiveLimit(options.maxBytes, DEFAULT_MAX_BYTES);
  const maxTime = positiveLimit(options.maxTimeMs, DEFAULT_MAX_TIME);
  const started = Date.now(), controller = new AbortController();
  const cancel = () => controller.abort(new Error('已取消解压，原压缩包保持不变。'));
  if (options.signal?.aborted) cancel();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('解压超时，原压缩包保持不变。')), Math.min(maxTime, 2_147_483_647));
  const anchors = new Map<string, { file: string; identity: Identity }>();
  const owned = new Map<string, Owned>();
  const inputs: Source[] = [];
  let directory = '', files = 0, bytes = 0, entryCount = 0, payloadPaths = 0;

  function check(): void {
    options.assertAvailable?.();
    if (controller.signal.aborted) throw controller.signal.reason;
    if (Date.now() - started >= maxTime) throw new Error('解压超时，原压缩包保持不变。');
  }

  function captureDirectories(folder: string): void {
    const chain: string[] = [];
    for (let current = folder;; current = path.dirname(current)) {
      chain.push(current);
      if (current === path.dirname(current)) break;
    }
    for (const file of chain.reverse()) {
      const stat = fs.lstatSync(file, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('解压不支持链接或重定向目录。');
      const previous = anchors.get(key(file));
      if (previous && !sameIdentity(previous.identity, stat)) throw new Error('解压目录已发生变化，请重新选择。');
      anchors.set(key(file), { file, identity: stat });
    }
  }

  function assertAnchors(): void {
    for (const anchor of anchors.values()) {
      const current = fs.lstatSync(anchor.file, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, anchor.identity)) {
        throw new Error('解压目录已发生变化，已停止写入。');
      }
    }
  }

  function assertOwned(item: Owned): void {
    const stat = fs.lstatSync(item.file, { bigint: true });
    if (stat.isSymbolicLink() || !sameIdentity(stat, item.identity) ||
        (item.directory ? !stat.isDirectory() : !ordinaryFile(stat))) {
      throw new Error('解压目标已发生变化，已停止写入。');
    }
  }

  function assertOutputPath(file: string): void {
    const relative = path.relative(directory, file);
    if ((relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative))) {
      throw new Error('解压路径超出目标目录。');
    }
    assertAnchors();
    for (let current = file;; current = path.dirname(current)) {
      const item = owned.get(key(current));
      if (item) assertOwned(item);
      if (key(current) === key(directory)) break;
      if (current === path.dirname(current)) throw new Error('解压路径超出目标目录。');
    }
  }

  function assertSource(source: Source, fd?: number): void {
    const current = fs.lstatSync(source.file, { bigint: true });
    const unchanged = (stat: fs.BigIntStats) => ordinaryFile(stat) && sameIdentity(stat, source.stat) &&
      stat.size === source.stat.size && stat.mtimeNs === source.stat.mtimeNs && stat.ctimeNs === source.stat.ctimeNs;
    if (!unchanged(current) || (fd !== undefined && !unchanged(fs.fstatSync(fd, { bigint: true })))) {
      throw new Error('原压缩包已发生变化，请等待下载完成后重试。');
    }
  }

  function makeDirectory(file: string): void {
    check();
    if (directory && owned.has(key(directory))) assertOutputPath(path.dirname(file));
    else assertAnchors();
    fs.mkdirSync(file, { mode: 0o700 }); // Exclusive: never adopts a pre-existing directory.
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n || stat.birthtimeNs === 0n) {
      throw new Error('解压磁盘不支持可靠目录标识。');
    }
    owned.set(key(file), { file, identity: stat, directory: true });
    assertOutputPath(file);
  }

  function cleanup(): void {
    // A replaced parent/root causes cleanup to stop. Unknown or replaced children are
    // left alone; rmdir cannot remove a directory containing someone else's files.
    for (const item of [...owned.values()].reverse()) {
      try {
        assertOutputPath(item.file);
        if (item.directory) fs.rmdirSync(item.file);
        else fs.unlinkSync(item.file);
      } catch { /* Preserve anything whose identity or containment is no longer certain. */ }
    }
  }

  async function extractOne(source: Source, index: number): Promise<void> {
    check(); assertAnchors(); assertSource(source);
    const fd = fs.openSync(source.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    let zip: yauzl.ZipFile | undefined;
    let zipError: Error | undefined;
    try {
      assertSource(source, fd);
      zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
        yauzl.fromFd(fd, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, value) => {
          if (error) reject(error);
          else {
            value.on('error', error => { zipError = error; });
            resolve(value);
          }
        });
      });
      check(); assertAnchors(); assertSource(source, fd);
      if (zip.entryCount > maxFiles - entryCount) throw new Error('解压文件和目录数量超过上限。');
      const subtree = path.join(directory, String(index + 1).padStart(3, '0') + '-' + safeLabel(path.basename(source.file).replace(/\.zip$/i, '')));
      makeDirectory(subtree);
      const names = new Map<string, { spelling: string; directory: boolean; explicit: boolean }>();

      const nextEntry = (): Promise<yauzl.Entry | undefined> => new Promise((resolve, reject) => {
        const clear = () => {
          zip!.removeListener('entry', onEntry); zip!.removeListener('end', onEnd); zip!.removeListener('error', onError);
          controller.signal.removeEventListener('abort', onAbort);
        };
        const onEntry = (entry: yauzl.Entry) => { clear(); resolve(entry); };
        const onEnd = () => { clear(); resolve(undefined); };
        const onError = (error: Error) => { clear(); reject(error); };
        const onAbort = () => onError(controller.signal.reason);
        zip!.once('entry', onEntry); zip!.once('end', onEnd); zip!.once('error', onError);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        else if (zipError) onError(zipError);
        else zip!.readEntry();
      });

      for (;;) {
        check(); assertOutputPath(subtree); assertSource(source, fd);
        const entry = await nextEntry();
        if (!entry) break;
        check();
        if (++entryCount > maxFiles) throw new Error('解压文件和目录数量超过上限。');
        const raw = entry.fileName, isDirectory = raw.endsWith('/');
        const parts = (isDirectory ? raw.slice(0, -1) : raw).split('/');
        if (raw.length > 4096 || parts.length > 128 || parts.some(part => !part || part === '.' || part === '..' ||
          part.length > 255 || INVALID_COMPONENT.test(part) || /[. ]$/.test(part) || DEVICE.test(part))) {
          throw new Error('ZIP 包含不安全的文件名或路径。');
        }
        const type = (entry.externalFileAttributes >>> 16) & 0xf000;
        if ((type !== 0 && type !== 0x8000 && type !== 0x4000) || (type === 0x4000 && !isDirectory) ||
            (type === 0x8000 && isDirectory) || (entry.externalFileAttributes & 0x400) !== 0) {
          throw new Error('ZIP 包含链接或特殊文件，无法安全解压。');
        }
        if (entry.isEncrypted()) throw new Error('暂不支持加密 ZIP，请先使用密码解压后导入。');
        if (![0, 8].includes(entry.compressionMethod)) throw new Error('ZIP 使用了暂不支持的压缩格式。');
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > maxBytes - bytes) {
          throw new Error('解压后总体积超过上限。');
        }
        if (isDirectory && (entry.uncompressedSize !== 0 || entry.crc32 !== 0)) throw new Error('ZIP 目录记录已损坏。');

        let relative = '';
        for (let partIndex = 0; partIndex < parts.length; partIndex++) {
          relative += (relative ? '/' : '') + parts[partIndex];
          const directoryEntry = partIndex < parts.length - 1 || isDirectory;
          const explicit = partIndex === parts.length - 1;
          const nameKey = relative.normalize('NFC').toUpperCase();
          const previous = names.get(nameKey);
          if (previous && (previous.spelling !== relative || previous.directory !== directoryEntry || (previous.explicit && explicit))) {
            throw new Error('ZIP 文件名重复或存在大小写、Unicode、文件与目录冲突。');
          }
          if (previous) previous.explicit ||= explicit;
          else {
            if (++payloadPaths > maxFiles) throw new Error('解压文件和目录数量超过上限。');
            names.set(nameKey, { spelling: relative, directory: directoryEntry, explicit });
            if (directoryEntry) makeDirectory(path.join(subtree, ...relative.split('/')));
          }
        }
        if (isDirectory) {
          // A directory still has a local ZIP record: validate its actual empty
          // payload, rather than trusting a zero size/CRC in the central index.
          const input = await new Promise<Readable>((resolve, reject) => zip!.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
          await pipeline(input, new Writable({
            write(chunk: Buffer, _encoding, callback) {
              callback(chunk.length ? new Error('ZIP 目录记录包含异常内容。') : null);
            },
          }), { signal: controller.signal });
          check(); assertOutputPath(subtree); assertSource(source, fd);
          continue;
        }
        const target = path.join(subtree, ...parts);
        check(); assertSource(source, fd); assertOutputPath(path.dirname(target));
        const outputFd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
        let handedToStream = false;
        try {
          const stat = fs.fstatSync(outputFd, { bigint: true });
          owned.set(key(target), { file: target, identity: stat, directory: false });
          assertOutputPath(target);
          const input = await new Promise<Readable>((resolve, reject) => zip!.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)));
          let count = 0, checksum = 0;
          const meter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              try {
                check(); assertOutputPath(target); assertSource(source, fd);
                count += chunk.length;
                if (count > entry.uncompressedSize) throw new Error('ZIP 文件大小校验失败。');
                if (chunk.length > maxBytes - bytes) throw new Error('解压后总体积超过上限。');
                bytes += chunk.length;
                checksum = crc32(chunk, checksum);
                callback(null, chunk);
              } catch (error) { callback(error as Error); }
            },
          });
          const output = fs.createWriteStream(target, { fd: outputFd, autoClose: true });
          handedToStream = true;
          await pipeline(input, meter, output, { signal: controller.signal });
          check(); assertOutputPath(target); assertSource(source, fd);
          if (count !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error('ZIP 文件 CRC 或大小校验失败，压缩包可能已损坏。');
          if (fs.lstatSync(target, { bigint: true }).size !== BigInt(count)) throw new Error('解压文件大小校验失败。');
          files++;
        } finally {
          if (!handedToStream) fs.closeSync(outputFd);
        }
      }
      check(); assertSource(source, fd);
      if (zipError) throw zipError;
    } finally {
      if (zip) {
        const active = zip;
        await new Promise<void>(resolve => {
          active.once('close', resolve);
          active.once('error', () => resolve());
          active.close();
        });
      } else fs.closeSync(fd);
    }
  }

  try {
    check();
    if (!Array.isArray(sources) || !sources.length || sources.length > maxFiles) throw new Error('请选择数量在上限以内的 ZIP 压缩包。');
    const destination = absolutePath(parent);
    captureDirectories(destination);
    const seen = new Set<string>();
    for (const value of sources) {
      check();
      if (!supportsDownloadExtraction(value)) throw new Error('目前仅支持解压 ZIP；UnityPackage 可直接导入，其他格式请先手动解压。');
      const file = absolutePath(value);
      captureDirectories(path.dirname(file));
      const stat = fs.lstatSync(file, { bigint: true });
      if (!ordinaryFile(stat)) throw new Error('解压来源必须是普通文件，不能使用符号链接或硬链接。');
      const identity = stat.dev + ':' + stat.ino;
      if (seen.has(identity)) throw new Error('同一个 ZIP 压缩包不能重复解压到同一组。');
      seen.add(identity); inputs.push({ file, stat });
    }
    directory = path.join(destination, safeLabel(label) + '--vrcal-unpacked-' + randomUUID());
    makeDirectory(directory);
    for (let index = 0; index < inputs.length; index++) await extractOne(inputs[index], index);
    check(); assertAnchors();
    for (const source of inputs) assertSource(source);
    for (const item of owned.values()) assertOutputPath(item.file);
    return { directory, files, bytes };
  } catch (error) {
    cleanup();
    const reason = controller.signal.aborted ? controller.signal.reason : error;
    throw new Error('解压失败：' + (reason instanceof Error ? reason.message : String(reason)));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
