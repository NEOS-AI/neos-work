import { streamLabel, type StreamInfo } from "@video/lib/types/video";
import { Label } from "@video/components/ui/label";
import { useI18n } from "@video/lib/i18n";

export function StreamPicker({
  streams,
  types,
  selected,
  onChange,
  multiple = false,
  name,
  emptyLabel,
}: {
  streams: StreamInfo[];
  types: Array<StreamInfo["codec_type"]>;
  selected: number[];
  onChange: (indices: number[]) => void;
  multiple?: boolean;
  name?: string;
  emptyLabel?: string;
}) {
  const { t } = useI18n();
  const filtered = streams.filter((s) => types.includes(s.codec_type));

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{emptyLabel ?? t("streams.empty")}</p>
    );
  }

  const toggle = (index: number) => {
    if (multiple) {
      onChange(
        selected.includes(index)
          ? selected.filter((i) => i !== index)
          : [...selected, index].sort((a, b) => a - b)
      );
      return;
    }
    onChange([index]);
  };

  return (
    <div className="space-y-2">
      {filtered.map((stream) => {
        const checked = selected.includes(stream.index);
        return (
          <Label
            key={stream.index}
            className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-normal"
          >
            <input
              type={multiple ? "checkbox" : "radio"}
              name={name ?? `stream-${types.join("-")}`}
              checked={checked}
              onChange={() => toggle(stream.index)}
              className="size-3.5 accent-primary"
            />
            <span>{streamLabel(stream)}</span>
          </Label>
        );
      })}
    </div>
  );
}
