'use client';

import { useOrganizationsControllerGetV1 } from '@synapsedesk/api-client';
import {
  BookOpenIcon,
  InboxIcon,
  MessageCircleIcon,
  TicketIcon,
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
import { NotificationsLive } from '@/components/notifications/store';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { useViewer } from '@/hooks/use-viewer';
import { TwoStepWarning } from './two-step-warning';
import { UserMenu } from './user-menu';

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** The paths it's the current item for. */
  active: (pathname: string) => boolean;
};

const ASK: Item = {
  label: 'Ask',
  href: '/ask',
  icon: MessageCircleIcon,
  active: (path) => path.startsWith('/ask'),
};
const KNOWLEDGE: Item = {
  label: 'Knowledge',
  href: '/knowledge',
  icon: BookOpenIcon,
  active: (path) => path.startsWith('/knowledge'),
};

/** The sidebar's items by role. An end user's tickets are their requests. */
const ITEMS = {
  agent: [
    {
      label: 'Tickets',
      href: '/tickets',
      icon: TicketIcon,
      active: (path) => path.startsWith('/tickets'),
    },
    KNOWLEDGE,
    ASK,
  ],
  requester: [
    ASK,
    {
      label: 'My requests',
      href: '/requests',
      icon: InboxIcon,
      active: (path) =>
        path.startsWith('/requests') || path.startsWith('/tickets'),
    },
    KNOWLEDGE,
  ],
} satisfies Record<string, Item[]>;

/**
 * The signed-in frame: the sidebar (a Sheet on phones), and the page beside
 * it. The items depend on who is looking: an agent's queue comes first, an
 * end user's Ask.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isAgent } = useViewer();
  const organization = useOrganizationsControllerGetV1({
    query: { retry: false },
  });

  return (
    <RealtimeProvider>
      <NotificationsLive />
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
                {/* Muted, but not shadcn's 70% foreground, which fails AA contrast. */}
                <SidebarGroupLabel className="text-muted-foreground">
                  Support
                </SidebarGroupLabel>
                <SidebarMenu>
                  {ITEMS[isAgent ? 'agent' : 'requester'].map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={item.active(pathname)}
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
        <SidebarInset>
          <TwoStepWarning />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </RealtimeProvider>
  );
}
