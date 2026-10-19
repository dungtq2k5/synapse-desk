'use client';

import { authControllerLogoutV1 } from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  BellIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  ShieldCheckIcon,
  UserIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenuButton } from '@/components/ui/sidebar';
import { useViewer } from '@/hooks/use-viewer';
import { toastError } from '@/lib/toast';
import { UserAvatar } from './user-avatar';

/** Signs out and goes to sign-in; a failure is a toast with Try again. */
export function useSignOut(): () => Promise<void> {
  const queryClient = useQueryClient();
  const router = useRouter();
  const signOut = async () => {
    try {
      await authControllerLogoutV1({});
      queryClient.clear();
      router.push('/login?signed-out');
    } catch {
      toastError('Couldn’t sign out', 'Check your connection and try again.', {
        label: 'Try again',
        onClick: () => void signOut(),
      });
    }
  };
  return signOut;
}

/** The account button at the foot of the sidebar: theme and sign-out. */
export function UserMenu() {
  const { user } = useViewer();
  const { theme, setTheme } = useTheme();
  const signOut = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size="lg" aria-label="Account">
          <UserAvatar
            name={user?.fullName ?? null}
            src={user?.avatarUrl}
            className="size-8"
          />
          <span className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{user?.fullName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {user?.email}
            </span>
          </span>
          <ChevronsUpDownIcon className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60 shadow-md">
        <DropdownMenuLabel className="flex flex-col font-normal">
          <span className="font-medium">{user?.fullName}</span>
          <span className="text-xs text-muted-foreground">{user?.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserIcon />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/security">
            <ShieldCheckIcon />
            Security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/notifications/settings">
            <BellIcon />
            Notification settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme ?? 'system'}
          onValueChange={setTheme}
        >
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
