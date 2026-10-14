import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient as AuthPrisma } from '../../services/auth-service/src/generated/prisma/client';
import { databaseUrl } from './screens/tenant';

/**
 * What an email would have carried. Nothing reads mail here, and auth-service
 * keeps only hashes, so each helper writes the hash of a value it knows over
 * the one that was sent, in the same format auth-service checks, and returns
 * the value: as if read from the inbox.
 */

async function withAuthDb<T>(work: (prisma: AuthPrisma) => Promise<T>) {
  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('auth-service') }),
  });
  try {
    return await work(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/** auth-service's `hashCode`: salted scrypt, its parameters in the string. */
function hashCode(code: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(code, salt, 32, { N: 16_384, r: 8, p: 1 });
  return [
    'scrypt',
    'N=16384,r=8,p=1',
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

const sha256 = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** The code in the latest verification email to this address. */
export function emailCode(email: string): Promise<string> {
  const code = '246810';
  return withAuthDb(async (prisma) => {
    const { count } = await prisma.otp.updateMany({
      where: { target: email, purpose: 'EMAIL_VERIFICATION', isUsed: false },
      data: { codeHash: hashCode(code) },
    });
    if (count === 0) throw new Error(`No email code pending for ${email}`);
    return code;
  });
}

/** The link in the latest password-reset email to this address. */
export function resetLink(email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  return withAuthDb(async (prisma) => {
    const latest = await prisma.passwordResetToken.findFirst({
      where: { user: { email }, isUsed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!latest) throw new Error(`No reset link sent to ${email}`);
    await prisma.passwordResetToken.update({
      where: { id: latest.id },
      data: { tokenHash: sha256(token) },
    });
    return `/reset-password?token=${token}`;
  });
}

/** The link in the invitation email to this address. */
export function invitationLink(email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  return withAuthDb(async (prisma) => {
    const invitation = await prisma.userInvitation.findFirst({
      where: { email, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!invitation) throw new Error(`No invitation sent to ${email}`);
    await prisma.userInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash: sha256(token) },
    });
    return `/invitations/accept?token=${token}`;
  });
}

/** Marks this address verified, as entering its emailed code does. */
export function markVerified(email: string): Promise<void> {
  return withAuthDb(async (prisma) => {
    await prisma.user.updateMany({
      where: { email },
      data: { isEmailVerified: true },
    });
  });
}
