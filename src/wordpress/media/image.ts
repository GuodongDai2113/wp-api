import { extname } from "node:path";

import sharp, { type Metadata } from "sharp";

/** WebP 输出质量，与参考插件 `convert_to_webp` 的设置保持一致。 */
const WEBP_QUALITY = 85;

/** Sharp 解码时允许的最大像素数，用于限制异常图片造成的内存消耗。 */
const MAX_INPUT_PIXELS = 100_000_000;

/** 需要在上传前转换为 WebP 的源 MIME 类型。 */
const WEBP_SOURCE_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);

/** 图片宽高。 */
export interface ImageDimensions {
  /** 图片宽度，单位为像素。 */
  width: number;
  /** 图片高度，单位为像素。 */
  height: number;
}

/** 已准备好发送给 WordPress 的媒体二进制数据。 */
export interface PreparedMediaImage {
  /** 上传使用的文件名。 */
  filename: string;
  /** 上传使用的 MIME 类型。 */
  contentType: string;
  /** 上传使用的二进制内容。 */
  bytes: Buffer;
  /** 是否在本地完成了 WebP 转换。 */
  convertedToWebp: boolean;
}

/**
 * 按参考插件的规则计算 WebP 输出尺寸。
 *
 * 正方形且边长大于 800 像素时固定为 800×800；任一边达到 4000
 * 像素时缩至 50%，否则任一边达到 2000 像素时缩至 80%。
 */
export function calculateWebpDimensions(width: number, height: number): ImageDimensions {
  if (width === height && width > 800) {
    return { width: 800, height: 800 };
  }

  if (width >= 4000 || height >= 4000) {
    return {
      width: Math.trunc(width * 0.5),
      height: Math.trunc(height * 0.5)
    };
  }

  if (width >= 2000 || height >= 2000) {
    return {
      width: Math.trunc(width * 0.8),
      height: Math.trunc(height * 0.8)
    };
  }

  return { width, height };
}

/** 根据 EXIF 方向返回自动校正后的图片宽高。 */
function readOrientedDimensions(metadata: Metadata): ImageDimensions {
  if (!metadata.width || !metadata.height) {
    throw new Error("The local image does not contain readable width and height metadata.");
  }

  const swapsAxes = metadata.orientation !== undefined
    && metadata.orientation >= 5
    && metadata.orientation <= 8;

  return swapsAxes
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

/** 把原文件名的位图扩展名替换为 `.webp`。 */
function buildWebpFilename(filename: string): string {
  const extension = extname(filename);
  const stem = extension.length > 0 ? filename.slice(0, -extension.length) : filename;
  return `${stem}.webp`;
}

/**
 * 在内存中准备媒体上传内容。
 *
 * JPEG 与 PNG 会先自动校正 EXIF 方向，再按参考插件的阈值缩放并以质量
 * 85 转换为 WebP；GIF、AVIF 和现有 WebP 保持原样，避免动画丢失或重复
 * 有损压缩。整个过程不创建临时文件。
 */
export async function prepareMediaImage(
  bytes: Buffer,
  filename: string,
  sourceContentType: string
): Promise<PreparedMediaImage> {
  if (!WEBP_SOURCE_CONTENT_TYPES.has(sourceContentType)) {
    return {
      filename,
      contentType: sourceContentType,
      bytes,
      convertedToWebp: false
    };
  }

  try {
    const image = sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS
    });
    const metadata = await image.metadata();
    const orientedDimensions = readOrientedDimensions(metadata);
    const outputDimensions = calculateWebpDimensions(
      orientedDimensions.width,
      orientedDimensions.height
    );
    const shouldResize = outputDimensions.width !== orientedDimensions.width
      || outputDimensions.height !== orientedDimensions.height;

    let pipeline = image.autoOrient();
    if (shouldResize) {
      pipeline = pipeline.resize(outputDimensions.width, outputDimensions.height, {
        fit: "fill"
      });
    }

    const webpBytes = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
    return {
      filename: buildWebpFilename(filename),
      contentType: "image/webp",
      bytes: webpBytes,
      convertedToWebp: true
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to compress the local image as WebP: ${reason}`, { cause: error });
  }
}
