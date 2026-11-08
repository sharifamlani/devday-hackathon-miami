import { useEffect, useState } from "react";

import { DropdownMenuCheckboxItem } from "@/components/ui/dropdown-menu";
import { API_URL, DATA_MODE } from "../providers/local/config";

type LinkState = { on: boolean } | null;

/**
 * Laptop-only switch for the public site (docs/public-tunnel.md "Toggle"), in the profile menu.
 * On: devday-donor-desk.vercel.app shows this laptop's data through the tunnel. Off: the public service answers
 * 503 and visitors get the sample snapshot. Shown only when the app talks to the laptop's own service (local
 * mode, GET /public-mode enabled: false), so it never appears on the public site.
 */
export const readLinkState = async (fetchImpl: typeof fetch = fetch): Promise<LinkState> => {
  if (DATA_MODE !== "local") return null;
  try {
    const mode = await fetchImpl(`${API_URL}/public-mode`);
    if (!mode.ok || ((await mode.json()) as { enabled?: unknown }).enabled !== false) return null;
    const link = await fetchImpl(`${API_URL}/public-link`);
    return link.ok ? ((await link.json()) as { on: boolean }) : null;
  } catch {
    return null;
  }
};

export const PublicLinkMenuItem = () => {
  const [state, setState] = useState<LinkState>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    readLinkState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);

  if (!state) return null;

  const flip = async (on: boolean) => {
    setFailed(false);
    setState({ on });
    try {
      const r = await fetch(`${API_URL}/public-link`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setState((await r.json()) as { on: boolean });
    } catch {
      setState({ on: !on });
      setFailed(true);
    }
  };

  return (
    <DropdownMenuCheckboxItem
      checked={state.on}
      onCheckedChange={(checked) => void flip(Boolean(checked))}
      closeOnClick={false}
      className="cursor-pointer"
      title={state.on ? "Live data on devday-donor-desk.vercel.app" : "Visitors see the sample snapshot"}
      data-testid="public-link-toggle"
    >
      <span className="flex flex-col">
        <span>Public link {state.on ? "on" : "off"}</span>
        {failed && <span className="text-xs text-destructive">Couldn't change it</span>}
      </span>
    </DropdownMenuCheckboxItem>
  );
};
