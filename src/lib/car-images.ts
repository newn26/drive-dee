import eco from "@/assets/car-eco.jpg";
import sedan from "@/assets/car-sedan.jpg";
import suv from "@/assets/car-suv.jpg";
import van from "@/assets/car-van.jpg";

const map: Record<string, string> = { eco, ev: eco, sedan, suv, van };

export function carImage(imageUrl: string | null | undefined, category?: string) {
  if (imageUrl && /^https?:\/\//.test(imageUrl)) return imageUrl;
  return map[imageUrl ?? ""] ?? map[category ?? ""] ?? sedan;
}
