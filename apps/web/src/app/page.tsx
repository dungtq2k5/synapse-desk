import { redirect } from 'next/navigation';
import { HOME } from '@/lib/sign-in';

/** The root is the ticket list. */
export default function Home(): never {
  redirect(HOME);
}
