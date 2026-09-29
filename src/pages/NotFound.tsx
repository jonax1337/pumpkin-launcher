import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="py-24 text-center">
      <p className="text-sm text-primary">404</p>
      <h1 className="mt-2 text-3xl font-semibold">Seite nicht gefunden</h1>
      <Button asChild className="mt-6">
        <Link to="/">Zur Startseite</Link>
      </Button>
    </div>
  );
}
