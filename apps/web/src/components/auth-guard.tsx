
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const response = await fetch(
          `"/api/auth/me",
          { credentials: "include", cache: "no-store" }
        );

        if (!response.ok) {
          router.replace("/sign-in");
          return;
        }

        if (active) setAuthorized(true);
      } catch {
        router.replace("/sign-in");
      }
    }

    checkSession();

    return () => {
      active = false;
    };
  }, [router]);

  if (!authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0c0a10] text-zinc-400">
        Checking session...
      </main>
    );
  }

  return children;
}
