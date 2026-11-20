import { UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * A person's photo, or their initials when there's none (or it hasn't loaded),
 * or a generic figure when the name couldn't be resolved (the server sent
 * `null` for an id it has).
 */
export function UserAvatar({
  name,
  src,
  className,
}: {
  name: string | null;
  src?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn('size-6 text-[0.6875rem]', className)} aria-hidden>
      {src && <AvatarImage src={src} alt="" className="object-cover" />}
      <AvatarFallback className="bg-secondary font-medium text-secondary-foreground">
        {name ? initials(name) : <UserIcon className="size-3.5" />}
      </AvatarFallback>
    </Avatar>
  );
}
