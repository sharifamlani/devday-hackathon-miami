import { Button } from "@/components/ui/button";
import { SOCIAL_POSTING } from "../providers/local/config";

const NETWORKS = ["Instagram", "LinkedIn", "X"];

/** "Post to Instagram / LinkedIn / X": disabled while SOCIAL_POSTING is coming_soon. */
export const SocialPostingSoon = () => (
  <div className="flex flex-wrap items-center gap-2">
    {NETWORKS.map((network) => (
      <Button
        key={network}
        size="sm"
        variant="outline"
        disabled={SOCIAL_POSTING === "coming_soon"}
        title="Coming soon"
      >
        Post to {network}
      </Button>
    ))}
    {SOCIAL_POSTING === "coming_soon" && (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Coming soon</span>
    )}
  </div>
);
