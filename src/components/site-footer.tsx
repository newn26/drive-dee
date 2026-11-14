export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-muted/40 print:hidden">
      <div className="mx-auto max-w-7xl px-4 py-6 text-center text-sm text-muted-foreground">
        <p>© {year} Drive Dee · Siam Wheels Rental Hub</p>
      </div>
    </footer>
  );
}
