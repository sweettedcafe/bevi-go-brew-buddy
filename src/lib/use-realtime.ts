import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

/**
 * Subscribe to Supabase realtime changes on one or more tables and
 * trigger a callback whenever something changes. Use this to keep
 * lists/dashboards in sync the moment data changes anywhere.
 */
export function useRealtime(
  tables: string | string[],
  onChange: () => void,
  deps: unknown[] = [],
) {
  useEffect(() => {
    const list = Array.isArray(tables) ? tables : [tables];
    const channel = db.channel(`rt-${list.join("-")}-${Math.random()}`);
    for (const t of list) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: t },
        () => onChange(),
      );
    }
    channel.subscribe();
    return () => {
      db.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
