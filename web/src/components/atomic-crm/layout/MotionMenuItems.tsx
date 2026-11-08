import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  setMotionPreference,
  useMotionPreference,
  type MotionPreference,
} from "@/lib/motion";

const OPTIONS: { value: MotionPreference; label: string }[] = [
  { value: "system", label: "Match system" },
  { value: "reduce", label: "Reduce motion" },
  { value: "full", label: "Full motion" },
];

/**
 * Display settings in the profile menu (UserMenu children): how much the app animates.
 * "Reduce motion" stops slides, zooms and looping animations everywhere (src/lib/motion.ts).
 */
export const MotionMenuItems = () => {
  const preference = useMotionPreference();
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Motion
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) =>
            setMotionPreference(value as MotionPreference)
          }
        >
          {OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              className="cursor-pointer"
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuGroup>
    </>
  );
};
