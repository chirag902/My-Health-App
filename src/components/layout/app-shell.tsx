"use client";

import type { ReactNode } from "react";

import { Sidebar, SidebarInset } from "@/components/ui/sidebar";
import Header from "@/components/layout/header";
import SidebarNav from "./sidebar-nav";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({
  children,
}: AppShellProps) {
  return (
    <>
      <Sidebar>
        <SidebarNav />
      </Sidebar>

      <div className="flex min-h-screen w-full flex-col">
        <Header />

        <SidebarInset className="p-4 md:p-6 lg:p-8">
          {children}
        </SidebarInset>
      </div>
    </>
  );
}