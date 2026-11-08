import { useState, type ComponentType } from "react";
import { Building2, CalendarDays, Folder, User, Users, X } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import "./destinations.css";
import type { NoteDestination, NoteDestinationKind } from "./callNotes";

export interface DestinationOption {
  id: string;
  label: string;
  detail?: string;
  /** Picker section heading ("People", "Organizations"); options keep their order inside it. */
  section?: string;
  /** "organization" shows a building instead of the kind's icon. */
  icon?: "organization";
  /** Shown greyed out and can't be picked (e.g. a group with no one in it yet). */
  disabled?: boolean;
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

/** 38px square tiles; a filled tile widens to its name (destinations.css, on the motion variables). */
const tileBase =
  "dest-tile inline-flex h-[38px] items-stretch rounded-[10px] border bg-card text-[13px]";
/** Inset, so the tile's overflow clip (for the width animation) never cuts the ring off. */
const focusRing =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/** Groups options under their section headings, in the order the sections first appear. */
export const groupBySection = (options: DestinationOption[]) => {
  const sections = new Map<string, DestinationOption[]>();
  for (const option of options) {
    const key = option.section ?? "";
    sections.set(key, [...(sections.get(key) ?? []), option]);
  }
  return [...sections.entries()].map(([heading, items]) => ({
    heading,
    items,
  }));
};

/**
 * Where the call note is filed: "Today" plus one tile per kind (donor, group, project).
 * Empty tiles are icon-only squares with a tooltip; picking one widens it to the name
 * with a remove button.
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
      <Tooltip>
        <TooltipTrigger
          // A button so keyboard users can focus it and get the tooltip; it only explains.
          render={
            <button
              type="button"
              aria-label="Today: this note is saved to today"
              className={cn(
                tileBase,
                "w-[38px] items-center justify-center border-border text-foreground",
                focusRing,
              )}
            />
          }
        >
          <CalendarDays className="size-4" aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>Saved to today</TooltipContent>
      </Tooltip>
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
  const chosen = value ? options.find((o) => o.id === value.id) : undefined;
  const Icon = chosen?.icon === "organization" ? Building2 : config.icon;
  const label = value
    ? `${config.noun[0].toUpperCase()}${config.noun.slice(1)}: ${value.label}. Change`
    : config.add;

  const triggerProps = {
    "aria-label": label,
    className: cn(
      "inline-flex min-w-0 items-center gap-1.5 rounded-[9px] text-foreground",
      value
        ? "pr-1 pl-2.5"
        : "w-full justify-center text-muted-foreground hover:bg-accent hover:text-foreground",
      focusRing,
    ),
  };

  return (
    <span
      data-filled={value ? "" : undefined}
      className={cn(
        tileBase,
        value
          ? "border-foreground"
          : "border-dashed border-muted-foreground/70",
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        {value ? (
          // Filled: the name is visible, so no tooltip.
          <PopoverTrigger {...triggerProps}>
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="motion-fade-in max-w-[12rem] truncate">
              {value.label}
            </span>
          </PopoverTrigger>
        ) : (
          <Tooltip>
            <TooltipTrigger render={<PopoverTrigger {...triggerProps} />}>
              <Icon className="size-4 shrink-0" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>{config.add}</TooltipContent>
          </Tooltip>
        )}
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
              {groupBySection(options).map(({ heading, items }) => (
                <CommandGroup
                  key={heading || "all"}
                  heading={heading || undefined}
                >
                  {items.map((option) => {
                    const ItemIcon =
                      option.icon === "organization" ? Building2 : config.icon;
                    return (
                      <CommandItem
                        key={option.id}
                        value={`${config.kind}-${option.id}`}
                        keywords={[option.label]}
                        disabled={option.disabled}
                        onSelect={() => {
                          onPick(option);
                          setOpen(false);
                        }}
                        className="min-h-10 data-[disabled=true]:opacity-50"
                      >
                        <ItemIcon
                          className="size-4 opacity-70"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {option.label}
                        </span>
                        {option.detail && (
                          <span className="text-xs text-muted-foreground">
                            {option.detail}
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${value.label}`}
          className={cn(
            "grid w-8 shrink-0 place-items-center rounded-r-[9px] text-muted-foreground hover:bg-accent hover:text-foreground",
            focusRing,
          )}
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      )}
    </span>
  );
};
