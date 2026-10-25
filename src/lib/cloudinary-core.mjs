import manifest from "../data/cloudinary-images.json" with { type: "json" };

export const DEFAULT_CLOUD = "paulapplegate-com";
export const FORMATS = ["jxl", "avif", "webp"];
export const DEFAULT_WIDTHS = [320, 480, 640, 800, 960, 1280, 1600, 1920];
export const PROSE_SIZES = "(max-width: 720px) calc(100vw - 3rem), 672px";

export function normalizeWidths(widths) {
  if (
    !Array.isArray(widths) ||
    !widths.length ||
    widths.some((w) => !Number.isInteger(w) || w < 1)
  ) {
    throw new Error("Image widths must be a nonempty list of positive integers.");
  }
  return [...new Set(widths)].sort((a, b) => a - b);
}

function positiveDimension(value, name) {
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`Image ${name} must be a positive integer.`);
  return value;
}

function identity(publicId, cloudName) {
  if (typeof publicId !== "string" || !publicId.trim())
    throw new Error("A Cloudinary public ID is required.");
  const id = publicId.replace(/^cloudinary:/, "").replace(/^\/+/, "");
  if (id.includes("://") || id.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Use a Cloudinary public ID, not a URL or local file path.");
  }
  const cloud = cloudName?.trim() || DEFAULT_CLOUD;
  if (!/^[a-zA-Z0-9_-]+$/.test(cloud)) throw new Error("Invalid Cloudinary cloud name.");
  return { id, cloud, asset: manifest[`${cloud}/${id}`] };
}

export function getImageUrl(publicId, options = {}) {
  const { id, cloud, asset } = identity(publicId, options.cloudName);
  const format = options.format ?? "webp";
  if (![...FORMATS, "jpg"].includes(format)) throw new Error(`Unsupported image format: ${format}`);
  const t = [`f_${format}`, "q_auto"];
  if (options.width !== undefined) t.push(`w_${positiveDimension(options.width, "width")}`);
  if (options.height !== undefined) t.push(`h_${positiveDimension(options.height, "height")}`);
  if (options.crop) {
    if (!["fill", "scale", "crop", "thumb", "pad"].includes(options.crop))
      throw new Error("Unsupported crop mode.");
    t.push(`c_${options.crop}`);
  }
  if (options.gravity) {
    if (!["auto", "face", "center", "north", "south"].includes(options.gravity))
      throw new Error("Unsupported gravity.");
    t.push(`g_${options.gravity}`);
  }
  if (options.blur !== undefined) {
    if (!Number.isInteger(options.blur) || options.blur < 1 || options.blur > 2000)
      throw new Error("Blur must be between 1 and 2000.");
    t.push(`e_blur:${options.blur}`);
  }
  if (options.grayscale) t.push("e_grayscale");
  // v1 disambiguates public IDs containing folders when no upload version is saved.
  const version = asset?.version ?? 1;
  const path = id
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `https://res.cloudinary.com/${cloud}/image/upload/${t.join(",")}/v${version}/${path}`;
}

export function getSrcSet(publicId, widths = DEFAULT_WIDTHS, options = {}) {
  const ratio = options.width && options.height ? options.height / options.width : undefined;
  return normalizeWidths(widths)
    .map((width) => {
      const height = ratio ? Math.max(1, Math.round(width * ratio)) : undefined;
      return `${getImageUrl(publicId, { ...options, width, height })} ${width}w`;
    })
    .join(", ");
}

export function getPictureData(publicId, options = {}) {
  const { asset } = identity(publicId, options.cloudName);
  const width = positiveDimension(options.width ?? asset?.width, "width");
  const height = positiveDimension(options.height ?? asset?.height, "height");
  const sizes = options.sizes || asset?.sizes || PROSE_SIZES;
  const transforms = {
    ...options,
    width,
    height,
    crop: options.crop ?? "fill",
    gravity: options.gravity ?? "auto",
  };
  const sources = FORMATS.map((format) => {
    const widths = normalizeWidths(options.widths ?? asset?.widths?.[format] ?? DEFAULT_WIDTHS);
    return {
      type: `image/${format}`,
      srcset: getSrcSet(publicId, widths, { ...transforms, format }),
      sizes,
    };
  });
  return {
    sources,
    img: {
      src: getImageUrl(publicId, { ...transforms, format: "webp" }),
      srcset: sources[2].srcset,
      sizes,
      width,
      height,
    },
  };
}

// Social metadata is a single JPEG URL for crawlers, outside the page's picture fallback chain.
export function getOgImageUrl(publicId, options = {}) {
  return getImageUrl(publicId, {
    ...options,
    width: 1200,
    height: 630,
    crop: "fill",
    gravity: "auto",
    format: "jpg",
  });
}
