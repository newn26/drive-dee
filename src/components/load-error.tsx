import { AlertCircle, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Shown when data fails to load, so a failure never looks like an empty list. */
export function LoadError({
  title = "โหลดข้อมูลไม่สำเร็จ",
  message = "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง",
  onRetry,
  children,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  return (
    <div role="alert" className="mx-auto max-w-md px-4 py-20 text-center">
      <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
      <h2 className="mt-4 text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <div className="mt-6 flex flex-col gap-2">
        {onRetry && (
          <Button onClick={onRetry}>
            <RotateCw className="mr-2 h-4 w-4" /> ลองใหม่
          </Button>
        )}
        {children}
      </div>
    </div>
  );
}
