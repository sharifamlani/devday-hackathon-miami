/** Neighbors and Community members aren't donors: their profile says which tab, not a giving tier or status. */
export type NonGiverTab = "neighbor" | "community";

export const isNonGiver = (
  tab: string | null | undefined,
): tab is NonGiverTab => tab === "neighbor" || tab === "community";

export const TAB_ONE: Record<NonGiverTab, string> = {
  neighbor: "Neighbor",
  community: "Community member",
};
