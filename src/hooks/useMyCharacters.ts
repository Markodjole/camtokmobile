import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

export type CharacterRow = {
  id: string;
  name: string;
};

/**
 * Reads the caller's `characters` straight from Supabase. This mirrors
 * the query on `apps/web/src/app/live/go/page.tsx` so the mobile picker
 * and the web picker stay in sync.
 */
export function useMyCharacters() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my-characters", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<CharacterRow[]> => {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("characters")
        .select("id, name")
        .eq("creator_user_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}
