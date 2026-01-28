import { toHex } from "@cosmjs/encoding";
import { ChunkInfo } from "@agoric/cosmic-proto/swingset/swingset.js";

export interface BundleJson {
  moduleFormat: string;
  endoZipBase64: string;
  endoZipBase64Sha512: string;
  [key: string]: unknown;
}

const textEncoder = new TextEncoder();

export const encodeBundle = (bundleJson: string) =>
  textEncoder.encode(bundleJson);

export const getSha512Hex = async (bytes: Uint8Array) => {
  const safeBytes = new Uint8Array(bytes);
  const sha512Bytes = await crypto.subtle.digest("sha-512", safeBytes);
  return toHex(new Uint8Array(sha512Bytes));
};

export const validateBundleJson = (bundleString: string): BundleJson => {
  let bundleObject: BundleJson;
  try {
    bundleObject = JSON.parse(bundleString) as BundleJson;
  } catch (error) {
    throw new Error(
      // @ts-expect-error parse errors are in fact always Errors.
      `The submitted file is not in the expected format, not parsable as JSON: ${error.message}`,
    );
  }
  const { moduleFormat, endoZipBase64, endoZipBase64Sha512 } = bundleObject;
  if (moduleFormat !== "endoZipBase64") {
    throw new Error(
      `The submitted file does not have the expected moduleFormat value of endoZipBase64, got: ${moduleFormat}`,
    );
  }
  if (typeof endoZipBase64 !== "string") {
    throw new Error(
      "The submitted file does not have the expected endoZipBase64 property",
    );
  }
  if (typeof endoZipBase64Sha512 !== "string") {
    throw new Error(
      "The submitted file does not have the expected endoZipBase64Sha512 property",
    );
  }
  return bundleObject;
};

export const chunkBundle = async (
  bytes: Uint8Array,
  chunkSizeLimit: number,
) => {
  const bundleSha512Hex = await getSha512Hex(bytes);

  const chunks: Uint8Array[] = [];
  const info: ChunkInfo[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSizeLimit) {
    const chunk = bytes.subarray(
      i,
      Math.min(bytes.byteLength, i + chunkSizeLimit),
    );
    const chunkSha512Hex = await getSha512Hex(chunk);
    chunks.push(chunk);
    info.push({
      sha512: chunkSha512Hex,
      sizeBytes: BigInt(chunk.byteLength),
      state: 0,
    });
  }

  return {
    chunks,
    manifest: {
      sha512: bundleSha512Hex,
      sizeBytes: BigInt(bytes.byteLength),
      chunks: info,
    },
  };
};
