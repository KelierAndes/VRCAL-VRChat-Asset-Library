import type { AiClassificationInput, AiDiagnosticInput } from '../shared/ai-contracts';

/** Conservative local filter; this cannot recognize every arbitrary secret in plugin prose. */
export function redactAiText(value: unknown, maxLength = 4000): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, 32000)
    .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=][^\r\n]*/gi, '[credential]')
    .replace(/\b(?:bearer\s+|sk[-_])[a-z0-9._~+\/-]{6,}/gi, '[credential]')
    .replace(/\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|token|password|passwd|pwd|secret|session(?:id)?|username|user[_ -]?name|account|email)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '[private]')
    .replace(/\b(?:usr|avtr|wrld|file)_[a-f0-9-]{8,}/gi, '[identifier]')
    .replace(/(?:https?:\/\/|file:\/\/|ftp:\/\/)[^\s<>"']+/gi, '[url]')
    .replace(/\b[A-Z]:[\\/][^\r\n<>"|]*/gi, '[path]')
    .replace(/\\\\[^\s<>"']+/g, '[path]')
    .replace(/(?:^|[\s("'])\/(?!\/)[^\s<>"']+/g, ' [path]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/\b(?:eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+|[a-f0-9]{40,}|[A-Za-z0-9+/_-]{64,}={0,2})\b/gi, '[opaque]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim().slice(0, maxLength);
}

export function prepareClassificationInput(input: AiClassificationInput) {
  const filename = typeof input.filenameClue === 'string' ? input.filenameClue.replace(/\\/g, '/').split('/').pop() : '';
  return {
    publicTitle: redactAiText(input.publicTitle, 240),
    publicDescription: redactAiText(input.publicDescription, 2400),
    publicTags: Array.isArray(input.publicTags) ? input.publicTags.slice(0, 24).map(s => redactAiText(s, 60)).filter(Boolean) : [],
    filenameClue: redactAiText(filename, 200),
  };
}

export function prepareDiagnosticInput(input: AiDiagnosticInput) {
  // Only error-bearing lines are eligible. Stack frames and arbitrary source lines never leave this process.
  const lines = typeof input.excerpt === 'string' ? input.excerpt.slice(0, 32000).split(/\r?\n/).slice(0, 160) : [];
  const excerpt = lines.filter(line => (/\b(?:error|exception|failed|failure|CS\d{4}|compilation)\b|错误|异常|失败/i.test(line)||/^\s*(?:[\w.]+)?Exception\s*:/.test(line))
    && (/\b(?:error|warning)\s+CS\d{4}\s*:/i.test(line)||!/^\s*(?:at\s|(?:public|private|protected|internal|using|namespace|class|const|let|var|import|export|def|return)\s|[{}]|[\w.]+\s*\()/i.test(line)))
    .slice(0, 20)
    .map(line => {
      // Preserve the compiler's actual diagnostic while dropping its private source-file prefix.
      const compiler = line.match(/\b(?:error|warning)\s+CS\d{4}\s*:.*/i);
      return redactAiText(compiler ? compiler[0] : line, 600);
    }).filter(Boolean).join('\n').slice(0, 6000);
  const version = (v: unknown) => typeof v === 'string' && /^[0-9][a-zA-Z0-9.+_-]{0,49}$/.test(v) ? v : '';
  return { excerpt, unityVersion: version(input.unityVersion), sdkVersion: version(input.sdkVersion), maVersion: version(input.maVersion) };
}
