import {
  ChartColumnIcon,
  CircleHelpIcon,
  FlagIcon,
  HeadsetIcon,
  InboxIcon,
  type LucideIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SectionHeader } from './section-header';

const FEATURES: { name: string; sentence: string; icon: LucideIcon }[] = [
  {
    name: 'Ask, with sources',
    sentence:
      'Answers cite the passages they come from, so anyone can check them.',
    icon: CircleHelpIcon,
  },
  {
    name: 'The agent workspace',
    sentence: 'Queues, assignment, and an AI co-pilot that drafts replies.',
    icon: HeadsetIcon,
  },
  {
    name: 'A knowledge base that tells you what’s wrong with it',
    sentence:
      'Flags show the documents that are out of date, never found, or in conflict.',
    icon: FlagIcon,
  },
  {
    name: 'Email in, tickets out',
    sentence:
      'Mail sent to your support address becomes a ticket, with its files.',
    icon: InboxIcon,
  },
  {
    name: 'Analytics',
    sentence: 'Volume, response times, deflection, and AI spend.',
    icon: ChartColumnIcon,
  },
  {
    name: 'Built for teams',
    sentence:
      'Roles and permissions, two-step sign-in, an audit log, and webhooks.',
    icon: ShieldCheckIcon,
  },
];

/** What's inside: six cards, three columns at 1440 and one at 390. */
export function Features() {
  return (
    <section
      aria-labelledby="features-title"
      className="px-4 py-16 md:py-24 xl:px-0"
    >
      <div className="mx-auto max-w-300">
        <SectionHeader
          id="features-title"
          title="What’s inside"
          lead="Everything here works in this demo, today."
        />
        <ul className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.name}>
                <Card className="h-full gap-3 p-6">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <h3 className="mt-1 text-base font-semibold">
                    {feature.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {feature.sentence}
                  </p>
                </Card>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
