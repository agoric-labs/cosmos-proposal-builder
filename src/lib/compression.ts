export const gzip = async (uncompressedBytes: Uint8Array) => {
  const safeBytes = new Uint8Array(uncompressedBytes);
  const uncompressedBlob = new Blob([safeBytes], {
    type: "application/octet-stream",
  });
  const compressionStream = new CompressionStream("gzip");
  const compressedStream = uncompressedBlob
    .stream()
    .pipeThrough(compressionStream);
  const compressedResponse = new Response(compressedStream);
  const compressedBlob = await compressedResponse.blob();
  const compressedArrayBuffer = await compressedBlob.arrayBuffer();
  const bytes = new Uint8Array(compressedArrayBuffer);
  return bytes;
};
