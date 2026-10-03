
"use client";

import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function RootProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
    >
      <SidebarProvider>
        {children}
      </SidebarProvider>

      <Toaster />
    </ThemeProvider>
  );
}
