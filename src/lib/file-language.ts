import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

export function getFileLanguage(filename: string): LanguageDescription | undefined {
  const basename = filename.trim().split(/[\\/]/).pop() ?? "";
  const normalized = basename.toLowerCase();

  if (/^(?:\.env(?:\..+)?|.+\.env)$/.test(normalized)) {
    return LanguageDescription.matchLanguageName(languages, "Shell", false) ?? undefined;
  }
  if (/^(?:dockerfile|containerfile)(?:\..+)?$/.test(normalized)) {
    return LanguageDescription.matchLanguageName(languages, "Dockerfile", false) ?? undefined;
  }
  if (/^(?:\.bashrc|\.zshrc|\.profile)$/.test(normalized) || normalized.endsWith(".zsh")) {
    return LanguageDescription.matchLanguageName(languages, "Shell", false) ?? undefined;
  }

  return (
    LanguageDescription.matchFilename(languages, basename) ??
    LanguageDescription.matchFilename(languages, normalized) ??
    undefined
  );
}
