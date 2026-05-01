export type ExperimentSource = {
  title?: string;
  url?: string;
  kind?: string;
  citation?: string;
};

export function experimentSources(value: unknown): ExperimentSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ExperimentSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = item as Record<string, unknown>;
    const title = stringField(source.title);
    const url = stringField(source.url);
    const kind = stringField(source.kind);
    const citation = stringField(source.citation);
    if (!url && !citation) continue;
    sources.push({
      ...(title ? { title } : {}),
      ...(url ? { url } : {}),
      ...(kind ? { kind } : {}),
      ...(citation ? { citation } : {}),
    });
  }
  return sources;
}

export function experimentSourceCount(value: unknown): number {
  return experimentSources(value).length;
}

export function experimentSourceLabel(source: ExperimentSource): string {
  return source.title || source.citation || source.url || "source";
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}
