import { useState, type ComponentType } from "react";
import { Folder, User, Users, X } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { NoteDestination, NoteDestinationKind } from "./callNotes";

export interface DestinationOption {
  id: string;
  label: string;
  detail?: string;
}

interface KindConfig {
  kind: NoteDestinationKind;
  add: string;
  noun: string;
  icon: ComponentType<{ className?: string }>;
}

const KINDS: KindConfig[] = [
  { kind: "donor", add: "Add to donor", noun: "donor", icon: User },
  { kind: "group", add: "Add to group", noun: "group", icon: Users },
  { kind: "project", add: "Add to project", noun: "project", icon: Folder },
];

const chipBase =
  "inline-flex min-h-9 items-center gap-1.5 rounded-[10px] border px-2.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * "Today" plus one chip per destination kind. An empty chip opens a
 * searchable picker; a filled chip shows the choice with a remove button.
 */
export const DestinationChips = ({
  destinations,
  onChange,
  options,
  loading,
}: {
  destinations: NoteDestination[];
  onChange: (next: NoteDestination[]) => void;
  options: Record<NoteDestinationKind, DestinationOption[]>;
  loading: Record<NoteDestinationKind, boolean>;
}) => {
  const set = (kind: NoteDestinationKind, option: DestinationOption | null) =>
    onChange([
      ...destinations.filter((d) => d.kind !== kind),
      ...(option ? [{ kind, id: option.id, label: option.label }] : []),
    ]);

  return (
    <div
      role="group"
      aria-label="Save this note to"
      className="flex flex-wrap gap-1.5"
    >
      <span className={cn(chipBase, "border-border bg-card text-foreground")}>
        Today
      </span>
      {KINDS.map((config) => (
        <DestinationChip
          key={config.kind}
          config={config}
          value={destinations.find((d) => d.kind === config.kind) ?? null}
          options={options[config.kind]}
          loading={loading[config.kind]}
          onPick={(option) => set(config.kind, option)}
          onRemove={() => set(config.kind, null)}
        />
      ))}
    </div>
  );
};

const DestinationChip = ({
  config,
  value,
  options,
  loading,
  onPick,
  onRemove,
}: {
  config: KindConfig;
  value: NoteDestination | null;
  options: DestinationOption[];
  loading: boolean;
  onPick: (option: DestinationOption) => void;
  onRemove: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const Icon = config.icon;

  const picker = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          value
            ? `${config.noun[0].toUpperCase()}${config.noun.slice(1)}: ${value.label}. Change`
            : config.add
        }
        className={cn(
          chipBase,
          value
            ? "rounded-r-none border-0 pr-1.5 text-foreground"
            : "border-dashed border-muted-foreground text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-[12rem] truncate">
          {value ? value.label : config.add}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`Choose a ${config.noun}`}
        className="w-72 max-w-[calc(100vw-32px)] gap-0 p-0"
      >
        <Command
          label={`Search ${config.noun}s`}
          // Match on the label (keywords); the value is the unique id.
          filter={(_value, search, keywords) =>
            (keywords ?? [])
              .join(" ")
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase())
              ? 1
              : 0
          }
        >
          <CommandInput placeholder={`Search ${config.noun}s`} />
          <CommandList>
            <CommandEmpty>
              {loading ? "Loading…" : `No ${config.noun}s found.`}
            </CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={`${config.kind}-${option.id}`}
                keywords={[option.label]}
                onSelect={() => {
                  onPick(option);
                  setOpen(false);
                }}
                className="min-h-10"
              >
                <Icon className="size-4 opacity-70" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.detail && (
                  <span className="text-xs text-muted-foreground">
                    {option.detail}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );

  if (!value) return picker;
  return (
    <span className="inline-flex items-stretch rounded-[10px] border border-foreground bg-card">
      {picker}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${value.label}`}
        className="grid min-h-9 w-8 place-items-center rounded-r-[10px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
};
