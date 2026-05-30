export interface RawSource {
  id: string;
  name: string;
  display_id: string;
}

export interface DisplayLike {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  primary: boolean;
}

export interface CaptureSource {
  id: string;
  kind: 'screen' | 'window';
  label: string;
  displayId?: number;
}

export interface FormatInput {
  sources: RawSource[];
  displays: DisplayLike[];
  /** mainWindow.getMediaSourceId() の値。自ウィンドウ除外に使う。 */
  selfMediaSourceId: string;
  labels: {
    /** 例: "ディスプレイ {{n}}（プライマリ・{{w}}×{{h}}）" */
    displayPrimary: string;
    /** 例: "ディスプレイ {{n}}（{{w}}×{{h}}）" */
    display: string;
  };
}

export function formatCaptureSources(input: FormatInput): CaptureSource[] {
  const { sources, displays, selfMediaSourceId, labels } = input;
  const displayById = new Map<number, { display: DisplayLike; index: number }>();
  displays.forEach((d, i) => displayById.set(d.id, { display: d, index: i }));

  const screens: CaptureSource[] = [];
  const windows: CaptureSource[] = [];

  for (const s of sources) {
    if (s.id === selfMediaSourceId) continue;
    if (s.id.startsWith('screen:')) {
      const did = Number(s.display_id);
      const entry = Number.isFinite(did) ? displayById.get(did) : undefined;
      if (!entry) continue; // 結合できないソースは除外
      const { display, index } = entry;
      const tpl = display.primary ? labels.displayPrimary : labels.display;
      const label = tpl
        .replace('{{n}}', String(index + 1))
        .replace('{{w}}', String(display.bounds.width))
        .replace('{{h}}', String(display.bounds.height));
      screens.push({ id: s.id, kind: 'screen', label, displayId: display.id });
    } else if (s.id.startsWith('window:')) {
      const name = s.name.trim();
      if (!name) continue;
      windows.push({ id: s.id, kind: 'window', label: name });
    }
  }

  windows.sort((a, b) => a.label.localeCompare(b.label));
  return [...screens, ...windows];
}
