import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown } from "lucide-react";

export type MultiOption = { value: string; label: string };

/** Searchable checkbox dropdown. Empty selection means "All". */
export function MultiSelect({
  options, selected, onChange, allLabel = "All", searchable = true, className = "",
}: {
  options: MultiOption[];
  selected: string[];
  onChange: (v: string[]) => void;
  allLabel?: string;
  searchable?: boolean;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const set = useMemo(() => new Set(selected), [selected]);
  const shown = options.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const summary = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label ?? "1 selected"
      : `${selected.length} selected`;
  const toggle = (v: string) => onChange(set.has(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={`h-9 min-w-[160px] justify-between font-normal ${className}`}>
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        {searchable && (
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="h-8 mb-2" />
        )}
        <div className="flex justify-between text-xs mb-1 px-1">
          <button type="button" className="text-primary hover:underline"
            onClick={() => onChange([...new Set([...selected, ...shown.map((o) => o.value)])])}>Select shown</button>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => onChange([])}>Clear (all)</button>
        </div>
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {shown.length === 0 ? (
            <div className="text-xs text-muted-foreground p-2">No matches</div>
          ) : shown.map((o) => (
            <label key={o.value} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={set.has(o.value)} onChange={() => toggle(o.value)} />
              <span className="truncate">{o.label}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
