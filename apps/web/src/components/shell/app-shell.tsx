'use client';

import { useOrganizationsControllerGetV1 } from '@synapsedesk/api-client';
import { TicketIcon } from 'lucide-react';
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
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { TwoStepWarning } from './two-step-warning';
import { UserMenu } from './user-menu';

/**
 * The signed-in frame: the sidebar (a Sheet on phones), and the page beside
 * it. Only Tickets is live; later areas join the Support group or their own.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const organization = useOrganizationsControllerGetV1({
    query: { retry: false },
  });

  return (
    <RealtimeProvider>
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
                <span className="truncate font-semibold">
                  {organization.data?.data?.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  SynapseDesk
                </span>
              </span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <nav aria-label="Main">
              <SidebarGroup>
                <SidebarGroupLabel>Support</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith('/tickets')}
                    >
                      <Link href="/tickets">
                        <TicketIcon />
                        Tickets
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
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
        <SidebarInset>
          <TwoStepWarning />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </RealtimeProvider>
  );
}
