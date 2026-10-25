/**
 * @file The schema step's first command: refuses a missing or `db push`-built
 * database before `prisma migrate deploy` runs (`databaseProblem` says why).
 * Run by `npm run db:apply` and the `migrate` image.
 */
import 'dotenv/config';
import { runDatabaseCheck } from '@synapsedesk/nest-common';

runDatabaseCheck();
