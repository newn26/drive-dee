import { Link } from "@tanstack/react-router";
import { Fuel, Settings2, Star, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { carImage, isStockCarImage } from "@/lib/car-images";
import { categoryLabel, thb } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

export function CarCard({ car, rating }: { car: Tables<"cars">; rating?: { avg: number; count: number } | undefined }) {
  return (
    <Link
      to="/cars/$id"
      params={{ id: car.id }}
      className="group overflow-hidden rounded-2xl border bg-card shadow-card transition hover:-translate-y-0.5 hover:shadow-lift"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-muted">
        <img
          src={carImage(car.image_url, car.category)}
          alt={`${car.brand} ${car.model}`}
          loading="lazy"
          width={1024}
          height={640}
          className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        />
        <Badge className="absolute left-3 top-3" variant="secondary">
          {categoryLabel[car.category] ?? car.category}
        </Badge>
        {isStockCarImage(car.image_url) && (
          <span className="absolute bottom-2 right-2 rounded-full bg-background/85 px-2 py-0.5 text-[10px] text-muted-foreground">
            ภาพประกอบ
          </span>
        )}
      </div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-display text-lg font-semibold leading-tight">
              {car.brand} {car.model}
            </h3>
            <p className="text-sm text-muted-foreground">ปี {car.year}</p>
          </div>
          {rating && rating.count > 0 && (
            <span className="flex items-center gap-1 text-sm font-medium">
              <Star className="h-4 w-4 fill-accent text-accent" /> {rating.avg.toFixed(1)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{car.seats} ที่นั่ง</span>
          <span className="flex items-center gap-1"><Settings2 className="h-3.5 w-3.5" />{car.transmission}</span>
          <span className="flex items-center gap-1"><Fuel className="h-3.5 w-3.5" />{car.fuel}</span>
        </div>
        <div className="flex items-end justify-between border-t pt-3">
          <span className="text-xs text-muted-foreground">ราคาต่อวัน</span>
          <span className="font-display text-xl font-semibold text-primary">{thb(car.price_per_day)}</span>
        </div>
      </div>
    </Link>
  );
}
