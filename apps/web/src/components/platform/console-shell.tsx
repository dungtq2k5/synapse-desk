'use client';

import {
  ActivityIcon,
  Building2Icon,
  GaugeIcon,
  PackageIcon,
  ScrollTextIcon,
  ShieldIcon,
  UserSearchIcon,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { UserMenu } from '@/components/shell/user-menu';
import { ConsoleContext } from './console-context';

type Item = { label: string; href: string; icon: LucideIcon };

/** The console's sections, in the sidebar's order. */
export const CONSOLE_SECTIONS: Item[] = [
  { label: 'Overview', href: '/platform', icon: GaugeIcon },
  {
    label: 'Organizations',
    href: '/platform/organizations',
    icon: Building2Icon,
  },
  { label: 'Plans', href: '/platform/plans', icon: PackageIcon },
  { label: 'People', href: '/platform/people', icon: UserSearchIcon },
  { label: 'Global roles', href: '/platform/roles', icon: ShieldIcon },
  { label: 'Jobs', href: '/platform/jobs', icon: ActivityIcon },
  { label: 'Audit log', href: '/platform/audit-log', icon: ScrollTextIcon },
];

const isCurrent = (pathname: string, href: string) =>
  href === '/platform'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

/**
 * The console's frame: its own sidebar ("SynapseDesk · Platform console",
 * the Platform group), the inverse bar, then the page. No organization's
 * name anywhere in it.
 */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <ConsoleContext value>
      <SidebarProvider>
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Skip to content
        </a>
        <Sidebar variant="sidebar" collapsible="offcanvas">
          <SidebarHeader>
            <div className="flex items-center gap-3 px-2 py-1.5">
              <Image
                src="/mark-light.svg"
                alt=""
                width={32}
                height={32}
                unoptimized
                className="size-8 rounded-md dark:hidden"
              />
              <Image
                src="/mark-dark.svg"
                alt=""
                width={32}
                height={32}
                unoptimized
                className="hidden size-8 rounded-md dark:block"
              />
              <span className="grid text-sm leading-tight">
                <span className="truncate font-semibold">SynapseDesk</span>
                <span className="text-xs text-muted-foreground">
                  Platform console
                </span>
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <nav aria-label="Platform">
              <SidebarGroup>
                <SidebarGroupLabel className="text-muted-foreground">
                  Platform
                </SidebarGroupLabel>
                <SidebarMenu>
                  {CONSOLE_SECTIONS.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isCurrent(pathname, item.href)}
                      >
                        <Link href={item.href}>
                          <item.icon />
                          {item.label}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            </nav>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <UserMenu />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </ConsoleContext>
  );
}
