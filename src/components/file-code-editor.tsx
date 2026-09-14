"use client";

import { useEffect, useMemo, useState } from "react";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import type { LanguageDescription, LanguageSupport } from "@codemirror/language";
import { getFileLanguage } from "@/lib/file-language";

const editorTheme = EditorView.theme({
  "&": { backgroundColor: "var(--card)", color: "var(--foreground)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-geist-mono), monospace",
    fontSize: "12px",
    lineHeight: "1.7",
  },
  ".cm-content": { padding: "12px 0", minHeight: "100%" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": {
    backgroundColor: "var(--background)",
    color: "var(--muted-foreground)",
    borderColor: "var(--border)",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--muted)" },
  ".cm-cursor": { borderLeftColor: "var(--foreground)" },
});

const basicSetup = {
  autocompletion: false,
  closeBrackets: false,
  highlightSelectionMatches: false,
};

export default function FileCodeEditor({
  filename,
  value,
  onChange,
}: {
  filename: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const language = getFileLanguage(filename);
  const [loaded, setLoaded] = useState<{
    language: LanguageDescription;
    support: LanguageSupport;
  } | null>(null);
  const [failed, setFailed] = useState<LanguageDescription | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (language) {
      language.load().then(
        (support) => {
          if (!cancelled) setLoaded({ language, support });
        },
        () => {
          if (!cancelled) setFailed(language);
        },
      );
    }
    return () => { cancelled = true; };
  }, [language]);

  const support = loaded?.language === language ? loaded?.support : undefined;
  const extensions = useMemo(() => [
    editorTheme,
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": "文件内容", spellcheck: "false" }),
    ...(support ? [support] : []),
  ], [support]);
  const loadingFailed = !!language && failed === language && !support;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card focus-within:ring-1 focus-within:ring-ring">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
        <span>{language?.name ?? "纯文本"}</span>
        {loadingFailed && <span>高亮加载失败，仍可编辑</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeMirror
          value={value}
          onChange={onChange}
          height="100%"
          className="h-full"
          extensions={extensions}
          basicSetup={basicSetup}
          indentWithTab={false}
        />
      </div>
    </div>
  );
}
