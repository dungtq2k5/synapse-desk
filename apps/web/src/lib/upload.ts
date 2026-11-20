/**
 * Sends a file's bytes to a presigned storage URL with the method the presign
 * named (`PUT` to a signed URL, `POST` to the local Storage emulator),
 * reporting progress as a whole percent.
 *
 * @example await sendFile(signed.uploadUrl, signed.uploadMethod, file, setPercent);
 */
export function sendFile(
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
