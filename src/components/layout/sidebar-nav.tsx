"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookText,
  FileText,
  Flame,
  HeartPulse,
  Stethoscope,
  User,
  Users,
} from "lucide-react";

import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAVIGATION_LINKS = [
  {
    href: "/diagnosis",
    label: "AI Companion",
    icon: Stethoscope,
  },
  {
    href: "/journal",
    label: "Journal",
    icon: BookText,
  },
  {
    href: "/habits",
    label: "Habit Tracker",
    icon: Flame,
  },
  {
    href: "/doctors",
    label: "Find a Doctor",
    icon: Users,
  },
  {
    href: "/records",
    label: "Health Records",
    icon: FileText,
  },
  {
    href: "/account",
    label: "My Account",
    icon: User,
  },
] as const;

export default function SidebarNav() {
  const pathname = usePathname();

  return (
    <>
      <SidebarHeader>
        <Link
          href="/diagnosis"
          className="flex items-center gap-2"
          aria-label="MyHealthApp home"
        >
          <HeartPulse
            className="h-8 w-8 text-primary"
            aria-hidden="true"
          />

          <span className="text-xl font-bold text-sidebar-foreground">
            MyHealthApp
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarMenu>
          {NAVIGATION_LINKS.map(
            ({ href, label, icon: Icon }) => {
              const isActive =
                pathname === href ||
                pathname.startsWith(`${href}/`);

              return (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={label}
                  >
                    <Link href={href}>
                      <Icon
                        aria-hidden="true"
                      />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            }
          )}
        </SidebarMenu>
      </SidebarContent>
    </>
  );
}