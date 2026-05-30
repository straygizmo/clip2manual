import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface CaptureSourceOption {
  id: string;
  kind: 'screen' | 'window';
  label: string;
  displayId?: number;
}

export interface SourcePickerProps {
  value: string | null;
  onChange: (sourceId: string) => void;
  disabled?: boolean;
}

export function SourcePicker({ value, onChange, disabled }: SourcePickerProps): JSX.Element {
  const { t } = useTranslation();
  const [sources, setSources] = useState<CaptureSourceOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh(): Promise<void> {
    const list = await window.api.listCaptureSources();
    setSources(list);
    setLoaded(true);
    if (!value && list.length > 0) {
      const firstScreen = list.find((s) => s.kind === 'screen') ?? list[0];
      onChange(firstScreen.id);
    }
  }

  // 初回マウントで一度だけ取得して既定（プライマリ画面）を選ぶ
  useEffect(() => { void refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const screens = sources.filter((s) => s.kind === 'screen');
  const windows = sources.filter((s) => s.kind === 'window');
  const current = sources.find((s) => s.id === value);

  return (
    <Select
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled}
      onOpenChange={(open) => { if (open) void refresh(); }}
    >
      <SelectTrigger className="min-w-64">
        <SelectValue placeholder={t('home.source.placeholder')}>
          {current?.label ?? (loaded ? t('home.source.empty') : t('home.source.loading'))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {screens.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t('home.source.groupScreens')}</SelectLabel>
            {screens.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectGroup>
        )}
        {windows.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t('home.source.groupWindows')}</SelectLabel>
            {windows.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
