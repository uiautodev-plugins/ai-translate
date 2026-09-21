/// <reference path="./plugin-runtime.d.ts" />
import { render } from 'preact';
import { useState, useCallback } from 'preact/hooks';
import { Languages, Loader2, Star, AlertCircle, Trash2, X } from 'lucide-preact';

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
  lang?: string;
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
    '- Replace any tab or newline inside the text with a space.',
    'Output one record per line, no header, no markdown fence, no explanation.',
    'Each line must be exactly: <lang><TAB><original><TAB><translation>',
    '- <lang> is the ISO 639-1 two-letter lowercase code of the original text (en, ar, ja...). Leave it empty if unknown.',
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

function makeItem(original: string, translation: string, lang?: string): TranslationItem | null {
  if (!original || !translation) return null;
  if (original.toLowerCase() === translation.toLowerCase()) return null;
  const code = (lang ?? '').trim().toLowerCase();
  return { original, translation, lang: code || undefined };
}

function parseTabLine(line: string): TranslationItem | null {
  const text = line
    .trim()
    .replace(/^```(?:\w+)?/, '')
    .replace(/```$/, '')
    .trim();
  if (!text.includes('\t')) return null;
  const parts = text.split('\t');
  if (parts.length < 2) return null;
  const hasLang = parts.length >= 3;
  const lang = hasLang ? parts[0] : '';
  const translation = parts[parts.length - 1];
  const original = (hasLang ? parts.slice(1, -1) : parts.slice(0, -1)).join(' ');
  return makeItem(original.trim(), translation.trim(), lang);
}

function parseItems(raw: string): TranslationItem[] {
  const text = raw.trim();
  if (!text) throw new Error('模型没有返回任何内容，请确认模型支持图片输入');
  return text
    .split('\n')
    .map(parseTabLine)
    .filter((item): item is TranslationItem => item !== null);
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames([navigator.language], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const FAVORITES_KEY = 'ai-translate:favorites';

function itemKey(item: TranslationItem): string {
  return `${item.lang ?? ''}\t${item.original}\t${item.translation}`;
}

function loadFavorites(): TranslationItem[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .map((v): TranslationItem | null => {
        if (!v || typeof v !== 'object') return null;
        const obj = v as any;
        if (typeof obj.original !== 'string' || typeof obj.translation !== 'string') return null;
        const code = typeof obj.lang === 'string' ? obj.lang.trim().toLowerCase() : '';
        return { original: obj.original, translation: obj.translation, lang: code || undefined };
      })
      .filter((item): item is TranslationItem => item !== null);
  } catch {
    return [];
  }
}

function saveFavorites(favorites: TranslationItem[]): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  } catch {
    /* ignore */
  }
}

function App() {
  const [target, setTarget] = useState('zh');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<TranslationItem[]>([]);
  const [favorites, setFavorites] = useState<TranslationItem[]>(loadFavorites);
  const [showFavorites, setShowFavorites] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);

  const currentLang = TARGET_LANGUAGES.find((l) => l.code === target) ?? TARGET_LANGUAGES[0];
  const targetLabel = currentLang.label;

  const displayed = showFavorites ? favorites : items;
  const favoriteKeys = new Set(favorites.map(itemKey));

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
            content:
              'You are a precise OCR and translation engine that only outputs tab-separated records.',
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
        const item = parseTabLine(line);
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

  const toggleFavorite = useCallback((item: TranslationItem) => {
    setFavorites((prev) => {
      const key = itemKey(item);
      const next = prev.some((f) => itemKey(f) === key)
        ? prev.filter((f) => itemKey(f) !== key)
        : [item, ...prev];
      saveFavorites(next);
      return next;
    });
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

        {favorites.length > 0 && (
          <button
            class={`inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border border-foreground/15 px-1.5 py-1.5 text-xs ${
              showFavorites ? 'text-yellow-500' : 'opacity-70 hover:opacity-100'
            }`}
            title="只看收藏"
            onClick={() => setShowFavorites((v) => !v)}
          >
            <Star size={14} class={showFavorites ? 'fill-current' : ''} />
            {favorites.length}
          </button>
        )}

        {!showFavorites && items.length > 0 && (
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
        {displayed.length === 0 ? (
          <div class="py-6 text-center text-xs opacity-40">
            {showFavorites ? '还没有收藏' : '点击按钮识别当前画面文字'}
          </div>
        ) : (
          <ul class="flex flex-col gap-1.5">
            {displayed.map((item) => {
              const fav = favoriteKeys.has(itemKey(item));
              return (
                <li
                  key={itemKey(item)}
                  class="group flex items-start gap-3 rounded-md border border-foreground/10 px-2.5 py-1.5 hover:border-primary/40"
                >
                  <div class="flex min-w-0 flex-1 items-start gap-1.5">
                    {item.lang && (
                      <span
                        class="mt-px shrink-0 rounded bg-foreground/10 px-1 py-px text-[10px] font-medium uppercase leading-tight opacity-60"
                        title={languageName(item.lang)}
                      >
                        {item.lang}
                      </span>
                    )}
                    <p class="min-w-0 flex-1 break-words text-xs leading-snug">{item.original}</p>
                  </div>
                  <p class="min-w-0 flex-1 break-words leading-snug">{item.translation}</p>
                  <button
                    class={`mt-px shrink-0 cursor-pointer transition-opacity ${
                      fav ? 'text-yellow-500' : 'opacity-50 hover:opacity-100'
                    }`}
                    title={fav ? '取消收藏' : '收藏'}
                    onClick={() => toggleFavorite(item)}
                  >
                    <Star size={13} class={fav ? 'fill-current' : ''} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {!showFavorites && loading && items.length > 0 && (
          <div class="flex justify-center px-1 py-1.5 opacity-50">
            <Loader2 size={12} class="animate-spin" />
          </div>
        )}
        {!showFavorites && !loading && elapsed !== null && (
          <div class="px-1 py-1.5 text-xs opacity-50">
            {items.length > 0 ? `共 ${items.length} 条 · ` : ''}用时 {elapsed.toFixed(2)}s
          </div>
        )}
      </div>
    </div>
  );
}

render(<App />, document.getElementById('app')!);
