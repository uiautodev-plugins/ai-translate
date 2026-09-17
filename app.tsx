/// <reference path="./plugin-runtime.d.ts" />
import { render } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { Languages, Loader2, Copy, Check, AlertCircle, Trash2, X } from 'lucide-preact';

const TARGET_LANGUAGES = [
  { code: 'zh', label: '中文', action: '翻译屏幕' },
  { code: 'en', label: 'English', action: 'Translate' },
  { code: 'ja', label: '日本語', action: '翻訳' },
  { code: 'ko', label: '한국어', action: '번역' },
  { code: 'fr', label: 'Français', action: 'Traduire' },
  { code: 'de', label: 'Deutsch', action: 'Übersetzen' },
  { code: 'es', label: 'Español', action: 'Traducir' },
  { code: 'ru', label: 'Русский', action: 'Перевести' },
  { code: 'ar', label: 'العربية', action: 'ترجم' },
];

interface TranslationItem {
  original: string;
  translation: string;
}

function buildPrompt(targetLabel: string): string {
  return [
    'You are a professional UI translator.',
    `Detect every readable text in the screenshot and translate it into ${targetLabel}.`,
    'Rules:',
    '- Auto-detect the source language of each text.',
    `- If a text is already in ${targetLabel}, skip it and do not output it.`,
    '- Ignore icons, pure numbers, dates, timestamps, URLs, code and untranslatable brand names.',
    '- Keep translations natural, concise and suitable for a mobile UI.',
    '- Merge duplicated strings.',
    'Output the result as JSON Lines: one JSON object per line, no array, no markdown fence, no explanation.',
    'Each line must be exactly: ["<original>","<translation>"]',
    'If there is no readable text, output nothing.',
  ].join('\n');
}

function extractText(content: OpenAIChatCompletionMessage['content'] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? '').join('');
  }
  return '';
}

function formatError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const obj = e as any;
    if (typeof obj.message === 'string' && obj.message) return obj.message;
    if (obj.error) {
      if (typeof obj.error === 'string') return obj.error;
      if (typeof obj.error?.message === 'string') return obj.error.message;
    }
    try {
      return JSON.stringify(e);
    } catch {
      /* fallthrough */
    }
  }
  return String(e);
}

function makeItem(original: string, translation: string): TranslationItem | null {
  if (!original || !translation) return null;
  if (original.toLowerCase() === translation.toLowerCase()) return null;
  return { original, translation };
}

function toItem(value: unknown): TranslationItem | null {
  if (Array.isArray(value)) {
    return makeItem(String(value[0] ?? '').trim(), String(value[1] ?? '').trim());
  }
  if (value && typeof value === 'object') {
    const obj = value as any;
    return makeItem(
      String(obj.o ?? obj.original ?? '').trim(),
      String(obj.t ?? obj.translation ?? '').trim(),
    );
  }
  return null;
}

function parseLine(line: string): TranslationItem | null {
  const text = line
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .replace(/,$/, '')
    .trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return toItem(JSON.parse(text));
  } catch {
    return null;
  }
}

function parseItems(raw: string): TranslationItem[] {
  let text = raw.trim();
  if (!text) throw new Error('模型没有返回任何内容，请确认模型支持图片输入');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const data = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(data)) {
        const items = data.map(toItem).filter((item): item is TranslationItem => item !== null);
        if (items.length > 0) return items;
      }
    } catch {
      /* fall through to JSON Lines parsing */
    }
  }

  const items = text
    .split('\n')
    .map(parseLine)
    .filter((item): item is TranslationItem => item !== null);
  if (items.length === 0 && !text.includes('{') && !text.includes('[')) {
    throw new Error(`模型返回内容无法解析：${text.slice(0, 200)}`);
  }
  return items;
}

function App() {
  const [target, setTarget] = useState('zh');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<TranslationItem[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const currentLang = TARGET_LANGUAGES.find((l) => l.code === target) ?? TARGET_LANGUAGES[0];
  const targetLabel = currentLang.label;

  const translate = useCallback(async () => {
    const startedAt = performance.now();
    setLoading(true);
    setError('');
    setItems([]);
    setElapsed(null);
    try {
      const dataUrl = await $u.screenshotAsBase64();
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');

      const params: OpenAIChatCompletionParams = {
        stream: true,
        reasoning_effort: 'none',
        messages: [
          {
            role: 'system',
            content: 'You are a precise OCR and translation engine that only outputs JSON Lines.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: buildPrompt(targetLabel) },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
            ],
          },
        ],
      };

      const res = await $u.openai(params);

      let raw = '';
      let buffer = '';
      const collected: TranslationItem[] = [];

      const pushLine = (line: string) => {
        const item = parseLine(line);
        if (!item) return;
        collected.push(item);
        setItems([...collected]);
      };

      if (res && typeof (res as any)[Symbol.asyncIterator] === 'function') {
        for await (const chunk of res as AsyncIterable<OpenAIChatCompletionChunk>) {
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (!delta) continue;
          raw += delta;
          buffer += delta;
          let index = buffer.indexOf('\n');
          while (index !== -1) {
            pushLine(buffer.slice(0, index));
            buffer = buffer.slice(index + 1);
            index = buffer.indexOf('\n');
          }
        }
        pushLine(buffer);
      } else {
        raw = extractText((res as OpenAIChatCompletion).choices?.[0]?.message?.content);
      }

      console.log('[ai-translate] content:', raw);

      if (collected.length === 0) {
        const parsed = parseItems(raw);
        setItems(parsed);
        if (parsed.length === 0) setError('未识别到可翻译的文字');
      }
    } catch (e) {
      console.error('[ai-translate] error:', e);
      setError(formatError(e));
    } finally {
      setElapsed((performance.now() - startedAt) / 1000);
      setLoading(false);
    }
  }, [targetLabel]);

  const copy = useCallback(async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied((cur) => (cur === index ? null : cur)), 1200);
    } catch {
      /* ignore */
    }
  }, []);

  const clear = useCallback(() => {
    setItems([]);
    setError('');
    setElapsed(null);
  }, []);

  return (
    <div class="flex flex-col gap-2 text-sm">
      <div class="flex items-center gap-2">
        <div class="relative">
          <Languages
            size={14}
            class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 opacity-60"
          />
          <select
            class="cursor-pointer appearance-none rounded-md border border-foreground/15 bg-background py-1.5 pl-7 pr-6 text-xs outline-none focus:border-primary"
            value={target}
            onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}
          >
            {TARGET_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        <button
          class="inline-flex cursor-pointer items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-50"
          onClick={translate}
          disabled={loading}
        >
          {loading ? <Loader2 size={14} class="animate-spin" /> : <Languages size={14} />}
          {currentLang.action}
        </button>

        {items.length > 0 && (
          <button
            class="inline-flex cursor-pointer items-center justify-center rounded-md border border-foreground/15 p-1.5 opacity-70 hover:opacity-100"
            title="清空"
            onClick={clear}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {error && (
        <div class="flex items-start gap-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
          <AlertCircle size={14} class="mt-px shrink-0" />
          <span class="min-w-0 flex-1 break-all">{error}</span>
          <button
            class="shrink-0 cursor-pointer opacity-60 hover:opacity-100"
            title="关闭"
            onClick={() => setError('')}
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div class="max-h-72 overflow-y-auto">
        {items.length === 0 ? (
          <div class="py-6 text-center text-xs opacity-40">点击按钮识别当前画面文字</div>
        ) : (
          <ul class="flex flex-col gap-1.5">
            {items.map((item, index) => (
              <li
                key={index}
                class="group flex cursor-pointer items-start gap-3 rounded-md border border-foreground/10 px-2.5 py-1.5 hover:border-primary/40"
                title="点击复制译文"
                onClick={() => copy(item.translation, index)}
              >
                <p class="min-w-0 flex-1 break-words text-xs leading-snug">{item.original}</p>
                <p class="min-w-0 flex-1 break-words leading-snug">{item.translation}</p>
                {copied === index ? (
                  <Check size={13} class="mt-0.5 shrink-0 text-green-500" />
                ) : (
                  <Copy
                    size={13}
                    class="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-50"
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        {loading && items.length > 0 && (
          <div class="flex justify-center px-1 py-1.5 opacity-50">
            <Loader2 size={12} class="animate-spin" />
          </div>
        )}
        {!loading && elapsed !== null && (
          <div class="px-1 py-1.5 text-xs opacity-50">
            {items.length > 0 ? `共 ${items.length} 条 · ` : ''}用时 {elapsed.toFixed(2)}s
          </div>
        )}
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
