import * as images from "./cloudinary-core.mjs";

export interface CloudinaryOptions {
  width?: number;
  height?: number;
  cloudName?: string;
  format?: "jxl" | "avif" | "webp";
  crop?: "fill" | "scale" | "crop" | "thumb" | "pad";
  gravity?: "auto" | "face" | "center" | "north" | "south";
  blur?: number;
  grayscale?: boolean;
}

const cloudName = import.meta.env.PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() || images.DEFAULT_CLOUD;

export function getImageUrl(publicId: string, options: CloudinaryOptions = {}) {
  return images.getImageUrl(publicId, { ...options, cloudName: options.cloudName || cloudName });
}

export function getSrcSet(publicId: string, widths?: number[], options: CloudinaryOptions = {}) {
  return images.getSrcSet(publicId, widths, {
    ...options,
    cloudName: options.cloudName || cloudName,
  });
}

export function getPictureData(
  publicId: string,
  options: CloudinaryOptions & { widths?: number[]; sizes?: string } = {},
) {
  return images.getPictureData(publicId, { ...options, cloudName: options.cloudName || cloudName });
}

export function getOgImageUrl(
  publicId: string,
  options: Pick<CloudinaryOptions, "cloudName"> = {},
) {
  return images.getOgImageUrl(publicId, { ...options, cloudName: options.cloudName || cloudName });
}
