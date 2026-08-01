import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

type Theme = "light" | "dark";

function savedTheme(): Theme {
  const saved = window.localStorage.getItem("bevi.theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  // Keep the server and first client render identical, then hydrate the saved
  // preference. This avoids a light/dark icon hydration mismatch.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(savedTheme());
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("bevi.theme", theme);
  }, [theme]);

  const next = theme === "dark" ? "light" : "dark";
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="fixed bottom-4 right-4 z-40 rounded-full bg-background shadow-lg"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}