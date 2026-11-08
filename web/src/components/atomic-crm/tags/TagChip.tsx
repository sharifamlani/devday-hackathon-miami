import { X } from "lucide-react";
import { useState } from "react";

import type { Tag } from "../types";
import { TagEditModal } from "./TagEditModal";

type TagChipProps = {
  tag: Tag;

  onUnlink: () => Promise<void>;
};

export function TagChip({ tag, onUnlink }: TagChipProps) {
  const [open, setOpen] = useState(false);

  const handleClose = () => {
    setOpen(false);
  };

  const handleClick = () => {
    setOpen(true);
  };

  return (
    <>
      {/* Two real buttons (edit, remove) so both work from the keyboard. */}
      <span
        className="text-black inline-flex items-center gap-1 rounded-md text-sm md:text-xs"
        style={{ backgroundColor: tag.color }}
      >
        <button
          type="button"
          onClick={handleClick}
          aria-label={`Edit tag ${tag.name}`}
          className="cursor-pointer rounded-md py-2 pl-4 md:py-1 md:pl-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          {tag.name}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnlink();
          }}
          aria-label={`Remove tag ${tag.name}`}
          className="cursor-pointer rounded-md p-1 pr-3 md:pr-1.5 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        >
          <X className="w-4 h-4 md:w-3 md:h-3" aria-hidden />
        </button>
      </span>
      <TagEditModal tag={tag} open={open} onClose={handleClose} />
    </>
  );
}
