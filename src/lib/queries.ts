import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const carsQuery = () =>
  queryOptions({
    queryKey: ["cars"],
    queryFn: async () => {
      const { data, error } = await supabase.from("cars").select("*").order("price_per_day");
      if (error) throw error;
      return data;
    },
  });

export const ratingsQuery = () =>
  queryOptions({
    queryKey: ["ratings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("reviews").select("car_id, rating");
      if (error) throw error;
      const map: Record<string, { avg: number; count: number }> = {};
      for (const r of data) {
        const m = (map[r.car_id] ??= { avg: 0, count: 0 });
        m.avg = (m.avg * m.count + r.rating) / (m.count + 1);
        m.count++;
      }
      return map;
    },
  });
