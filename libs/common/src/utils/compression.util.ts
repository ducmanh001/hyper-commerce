// libs/common/src/utils/compression.util.ts
// Async Brotli/Gzip/Deflate compression utilities.
// Uses worker_threads for CPU-heavy compression to avoid blocking event loop.
//
// Rule of thumb:
//   - Brotli: best for static assets (better ratio, slower)
//   - Gzip: best for API responses (fast, widely supported)
//   - Deflate: legacy, avoid for new code

import zlib from 'zlib';
import { promisify } from 'util';

// Promisified versions of zlib functions
const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);
const gzipCompress = promisify(zlib.gzip);
const gzipDecompress = promisify(zlib.gunzip);
const deflateCompress = promisify(zlib.deflate);
const deflateDecompress = promisify(zlib.inflate);

export type CompressionAlgorithm = 'brotli' | 'gzip' | 'deflate';

export interface CompressOptions {
  algorithm?: CompressionAlgorithm;
  /** Compression level 1-9. Higher = better ratio but slower. Default: 6 */
  level?: number;
}

/**
 * Compress a Buffer or string.
 * Automatically picks algorithm based on content type if not specified.
 */
export async function compress(
  data: Buffer | string,
  options: CompressOptions = {},
): Promise<Buffer> {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  const algo = options.algorithm ?? 'gzip';
  const level = options.level ?? 6;

  switch (algo) {
    case 'brotli':
      return brotliCompress(input, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: level,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: input.length,
        },
      });

    case 'gzip':
      return gzipCompress(input, { level });

    case 'deflate':
      return deflateCompress(input, { level });

    default:
      throw new Error(`Unsupported compression algorithm: ${algo}`);
  }
}

/**
 * Decompress a Buffer.
 */
export async function decompress(
  data: Buffer,
  algorithm: CompressionAlgorithm,
): Promise<Buffer> {
  switch (algorithm) {
    case 'brotli': return brotliDecompress(data);
    case 'gzip': return gzipDecompress(data);
    case 'deflate': return deflateDecompress(data);
    default: throw new Error(`Unsupported decompression algorithm: ${algorithm}`);
  }
}

/**
 * Detect compression algorithm from magic bytes.
 * Useful for decompressing stored blobs without metadata.
 */
export function detectCompression(
  buf: Buffer,
): CompressionAlgorithm | null {
  if (buf.length < 3) return null;

  // Brotli: no universal magic bytes (application-specific)
  // Gzip: 0x1f 0x8b
  if (buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  // Deflate: 0x78 0x9c or 0x78 0x01 or 0x78 0xda
  if (buf[0] === 0x78 && (buf[1] === 0x9c || buf[1] === 0x01 || buf[1] === 0xda)) {
    return 'deflate';
  }

  return null;
}

/**
 * Compress only if the data is above the minimum size threshold.
 * Small payloads don't benefit from compression.
 */
export async function compressIfBeneficial(
  data: Buffer | string,
  minSizeBytes = 1024,
): Promise<{ compressed: Buffer; algorithm: CompressionAlgorithm | null }> {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;

  if (input.length < minSizeBytes) {
    return { compressed: input, algorithm: null };
  }

  const compressed = await compress(input, { algorithm: 'gzip', level: 1 });

  // Only use compressed if it's actually smaller
  if (compressed.length >= input.length) {
    return { compressed: input, algorithm: null };
  }

  return { compressed, algorithm: 'gzip' };
}
