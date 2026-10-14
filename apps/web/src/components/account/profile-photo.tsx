'use client';

import {
  usersControllerConfirmAvatarV1,
  usersControllerDeleteAvatarV1,
  usersControllerPresignAvatarV1,
  type PresignAvatarDtoContentType,
  type UserResponseDto,
} from '@synapsedesk/api-client';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@synapsedesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { UserAvatar } from '@/components/shell/user-avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { announce } from '@/lib/toast';

type Problem = 'too-large' | 'failed';

/**
 * Sends the file where storage said: straight to Firebase Storage with the
 * method the presign named (PUT to a signed URL; POST to the local emulator),
 * with the declared type the signature pins, reporting progress as it goes.
 * XHR rather than `fetch`, which can't report upload progress.
 */
function send(
  url: string,
  method: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.setRequestHeader('Content-Type', file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onload = () =>
      request.status < 300
        ? resolve()
        : reject(new Error(`Storage answered ${request.status}`));
    request.onerror = () => reject(new Error('The upload failed'));
    request.send(file);
  });
}

/**
 * The profile photo: upload or change it (JPEG, PNG or WebP, up to 2 MB),
 * shown at once and uploaded straight to storage, then confirmed; or remove
 * it. The type and size are checked before uploading, and the server's
 * refusal is still handled. A failed or refused photo leaves the previous one.
 */
export function ProfilePhoto({ user }: { user: UserResponseDto }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [removing, setRemoving] = useState(false);

  // An object URL holds the file in memory until it's revoked.
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['/api/v1/users/me'] });

  const upload = async (file: File) => {
    setProblem(null);
    if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
      return setProblem('failed');
    }
    if (file.size > MAX_AVATAR_BYTES) return setProblem('too-large');

    setPreview(URL.createObjectURL(file));
    setProgress(0);
    try {
      const signed = await usersControllerPresignAvatarV1({
        contentType: file.type as PresignAvatarDtoContentType,
        sizeBytes: file.size,
        fileName: file.name,
      });
      if (!signed.data) throw new Error('No upload URL');
      await send(
        signed.data.uploadUrl,
        signed.data.uploadMethod,
        file,
        setProgress,
      );
      await usersControllerConfirmAvatarV1({
        objectPath: signed.data.objectPath,
      });
      await refresh();
      announce('Photo updated.');
    } catch {
      setProblem('failed');
    }
    setPreview(null);
    setProgress(null);
  };

  const remove = async () => {
    setRemoving(true);
    setProblem(null);
    try {
      await usersControllerDeleteAvatarV1();
      await refresh();
      announce('Photo removed.');
    } catch {
      setProblem('failed');
    }
    setRemoving(false);
  };

  const uploading = progress !== null;
  const hasPhoto = Boolean(user.avatarUrl);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <UserAvatar
          name={user.fullName}
          src={preview ?? user.avatarUrl}
          className="size-18 text-xl"
        />
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={uploading || removing}
              onClick={() => input.current?.click()}
            >
              <UploadIcon />
              {hasPhoto ? 'Change photo' : 'Upload photo'}
            </Button>
            {hasPhoto && !uploading && (
              <Button
                variant="ghost"
                size="sm"
                disabled={removing}
                onClick={() => void remove()}
              >
                <Trash2Icon />
                Remove
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            JPEG, PNG or WebP, up to 2 MB.
          </p>
          {uploading && (
            <div className="flex flex-col gap-1.5">
              <Progress
                value={progress}
                aria-label="Uploading photo"
                className="w-44"
              />
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <LoaderCircleIcon
                  aria-hidden
                  className="size-4 motion-safe:animate-spin"
                />
                Uploading photo… {progress}%
              </p>
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept={AVATAR_MIME_TYPES.join(',')}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void upload(file);
            }}
          />
        </div>
      </div>
      {problem === 'too-large' && (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon />
          <AlertTitle>That photo is too large</AlertTitle>
          <AlertDescription>Choose an image up to 2 MB.</AlertDescription>
        </Alert>
      )}
      {problem === 'failed' && (
        <Alert variant="destructive" role="alert">
          <CircleAlertIcon />
          <AlertTitle>Couldn’t upload your photo</AlertTitle>
          <AlertDescription>
            Check it’s a JPEG, PNG or WebP image, then try again.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
