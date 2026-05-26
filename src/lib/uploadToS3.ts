// Client helper for direct-to-S3 uploads. The server returns a presigned PUT
// URL; the browser PUTs the file bytes there with no auth — never round-trips
// through our app server (we deliberately don't want multi-GB streams).

export async function uploadToS3(file: File, uploadUrl: string): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
}
