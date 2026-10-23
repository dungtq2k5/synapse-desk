'use client';

import {
  ApiError,
  platformControllerCreateGlobalRoleV1,
  usePlatformControllerListGlobalRolesV1,
  usePlatformControllerGetMetricsV1,
  type CreateGlobalRoleDtoPermissionCodesItem as PermissionCode,
} from '@synapsedesk/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { PlusIcon, ShieldIcon, TriangleAlertIcon } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { toast } from 'sonner';
import { Field } from '@/components/auth/field';
import { Empty } from '@/components/documents/parts';
import { SystemBadge } from '@/components/settings/badges';
import { LoadError, Loading } from '@/components/settings/settings-frame';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  PERMISSION_GROUPS,
  PERMISSION_WORDS,
  permissionWords,
  roleDescription,
} from '@/lib/administration';
import { ConsolePage } from './console-page';

/**
 * The roles every organization has: the system ones and the platform's own.
 * Read-only, plus New global role, which every organization gets at once.
 */
export function GlobalRolesView() {
  const roles = usePlatformControllerListGlobalRolesV1({ limit: 100 });
  const [creating, setCreating] = useState(false);
  const data = roles.data?.data?.items;

  return (
    <ConsolePage
      crumbs={[{ label: 'Global roles' }]}
      title="Global roles"
      description="Roles every organization has. Each organization’s admins give them to their people."
      actions={
        <Button onClick={() => setCreating(true)}>
          <PlusIcon aria-hidden />
          New global role
        </Button>
      }
    >
      {roles.isError && !data ? (
        <LoadError what="global roles" onRetry={() => void roles.refetch()} />
      ) : !data ? (
        <Loading what="global roles" className="h-80" />
      ) : data.length === 0 ? (
        <Empty
          icon={<ShieldIcon />}
          title="No global roles yet"
          description=""
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Permissions</TableHead>
                  <TableHead>What it’s for</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell className="font-medium">{role.name}</TableCell>
                    <TableCell>
                      {role.isSystemRole ? <SystemBadge /> : 'Global'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {role.permissionCodes.length}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {roleDescription(role, 'its organization') ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {data.map((role) => (
              <li
                key={role.id}
                className="flex flex-col gap-1.5 rounded-lg border bg-card p-4 text-sm"
              >
                <span className="flex items-center justify-between gap-2 font-medium">
                  {role.name}
                  {role.isSystemRole ? <SystemBadge /> : <span>Global</span>}
                </span>
                <span className="text-muted-foreground">
                  {roleDescription(role, 'its organization') ?? '—'}
                </span>
                <span className="text-muted-foreground">
                  {`${role.permissionCodes.length} permissions`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <NewGlobalRoleDialog open={creating} onOpenChange={setCreating} />
    </ConsolePage>
  );
}

/**
 * New global role: it appears in every organization's roles at once, and
 * can't be limited to some. The catalog is the web's own (08's words): a
 * Super Admin can't read an organization's.
 */
function NewGlobalRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [codes, setCodes] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const metrics = usePlatformControllerGetMetricsV1({
    query: { enabled: open },
  });
  const organizations = metrics.data?.data?.totalOrganizations;

  const reset = () => {
    setName('');
    setDescription('');
    setCodes(new Set());
    setError(null);
  };
  const toggle = (code: string, on: boolean) => {
    const next = new Set(codes);
    if (on) next.add(code);
    else next.delete(code);
    setCodes(next);
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError('Required.');
      document.getElementById('global-role-name')?.focus();
      return;
    }
    setBusy(true);
    try {
      await platformControllerCreateGlobalRoleV1({
        name: name.trim(),
        description: description.trim() || undefined,
        permissionCodes: [...codes] as PermissionCode[],
      });
      void queryClient.invalidateQueries({
        queryKey: ['/api/v1/platform/roles'],
      });
      toast.success(`${name.trim()} is created`);
      reset();
      onOpenChange(false);
    } catch (failed) {
      setError(
        failed instanceof ApiError && failed.status === 409
          ? `A role named ${name.trim()} already exists.`
          : 'Something went wrong on our side. Try again in a moment.',
      );
    } finally {
      setBusy(false);
    }
  };

  const groups = PERMISSION_GROUPS.map((group) => ({
    group,
    items: Object.entries(PERMISSION_WORDS)
      .filter(([, words]) => words.group === group)
      .map(([code]) => code),
  })).filter((entry) => entry.items.length > 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => void submit(event)}
        >
          <DialogHeader>
            <DialogTitle>New global role</DialogTitle>
            <DialogDescription>
              It appears in every organization’s roles at once.
            </DialogDescription>
          </DialogHeader>
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden />
            <AlertTitle>Every organization gets it</AlertTitle>
            <AlertDescription>
              {organizations === 1
                ? 'The one organization sees it in its roles list, and its admins can give it to anyone. It can’t be limited to some organizations.'
                : `${organizations === undefined ? 'All' : `All ${organizations.toLocaleString('en-US')}`} organizations see it in their roles list, and their admins can give it to anyone. It can’t be limited to some organizations.`}
            </AlertDescription>
          </Alert>
          <Field id="global-role-name" label="Name" error={error} announce>
            {(aria) => (
              <Input
                id="global-role-name"
                value={name}
                autoComplete="off"
                onChange={(event) => setName(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          <Field id="global-role-description" label="What it’s for">
            {(aria) => (
              <Textarea
                id="global-role-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                {...aria}
              />
            )}
          </Field>
          {groups.map(({ group, items }) => (
            <fieldset key={group} className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">
                {group}{' '}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {items.filter((code) => codes.has(code)).length} of{' '}
                  {items.length}
                </span>
              </legend>
              {items.map((code) => (
                <div key={code} className="flex items-center gap-2">
                  <Checkbox
                    id={`global-${code}`}
                    checked={codes.has(code)}
                    onCheckedChange={(state) => toggle(code, state === true)}
                  />
                  <label htmlFor={`global-${code}`} className="text-sm">
                    {permissionWords(code)}
                  </label>
                </div>
              ))}
            </fieldset>
          ))}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>
              Create global role
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
