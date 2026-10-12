import { UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A person's initials, or a generic figure when the name couldn't be
 * resolved (the server sent `null` for an id it has). The API has no picture
 * to show yet.
 */
export function UserAvatar({
  name,
  className,
}: {
  name: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn('size-6 text-[0.6875rem]', className)} aria-hidden>
      <AvatarFallback className="bg-secondary font-medium text-secondary-foreground">
        {name ? initials(name) : <UserIcon className="size-3.5" />}
      </AvatarFallback>
    </Avatar>
  );
}
