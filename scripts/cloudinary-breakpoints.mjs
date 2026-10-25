import { createHash } from "node:crypto";
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseEnv, parseArgs } from "node:util";
import { dirname, resolve, relative, extname, basename, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_CLOUD,
  FORMATS,
  PROSE_SIZES,
  normalizeWidths,
} from "../src/lib/cloudinary-core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "src/data/cloudinary-images.json");

export function breakpointRequests({
  minWidth = 50,
  maxWidth = 1920,
  bytesStep = 20000,
  maxImages = 20,
} = {}) {
  for (const value of [minWidth, maxWidth, bytesStep, maxImages]) {
    if (!Number.isInteger(value) || value < 1)
      throw new Error("Breakpoint options must be positive integers.");
  }
  if (minWidth > maxWidth || maxImages < 3 || maxImages > 200)
    throw new Error("Require min-width <= max-width and 3–200 max-images.");
  return FORMATS.map((format) => ({
    create_derived: true,
    transformation: `f_${format},q_auto`,
    min_width: minWidth,
    max_width: maxWidth,
    bytes_step: bytesStep,
    max_images: maxImages,
  }));
}

export function assetFromResponse(result, cloudName, sizes) {
  if (
    !result.public_id ||
    !Number.isInteger(result.width) ||
    result.width < 1 ||
    !Number.isInteger(result.height) ||
    result.height < 1 ||
    !Number.isInteger(result.version)
  ) {
    throw new Error(
      "Cloudinary did not return a public ID, dimensions and version. The local manifest was not changed.",
    );
  }
  const widths = {};
  for (const format of FORMATS) {
    const group = result.responsive_breakpoints?.find(
      (item) =>
        new RegExp(`(?:^|[,/])f_${format}(?:$|[,/])`).test(item.transformation || "") ||
        item.breakpoints?.some((bp) =>
          new RegExp(`f_${format}(?:[,/])|\\.${format}(?:$|\\?)`).test(bp.secure_url || ""),
        ),
    );
    if (!group?.breakpoints?.length)
      throw new Error(
        `Cloudinary returned no ${format.toUpperCase()} breakpoints. The local manifest was not changed.`,
      );
    widths[format] = normalizeWidths(group.breakpoints.map((bp) => bp.width));
  }
  return {
    publicId: result.public_id,
    cloudName,
    width: result.width,
    height: result.height,
    version: result.version,
    sizes,
    widths,
  };
}

export function signature(params, apiSecret) {
  const serialized = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1")
    .update(serialized + apiSecret)
    .digest("hex");
}

export async function requestCloudinary(
  { cloudName, apiKey, apiSecret, publicId, file, overwrite = false, requests },
  fetcher = fetch,
) {
  if (!/^[a-zA-Z0-9_-]+$/.test(cloudName)) throw new Error("Invalid cloud name.");
  const params = {
    public_id: publicId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    responsive_breakpoints: JSON.stringify(requests),
    ...(file
      ? { overwrite: String(overwrite), ...(overwrite ? { invalidate: "true" } : {}) }
      : { type: "upload" }),
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.append(key, value);
  form.append("api_key", apiKey);
  form.append("signature", signature(params, apiSecret));
  if (file) form.append("file", new Blob([await readFile(file)]), basename(file));
  const response = await fetcher(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/${file ? "upload" : "explicit"}`,
    {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(180000),
    },
  );
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(result.error?.message || `Cloudinary request failed (${response.status}).`);
  if (result.existing && !overwrite)
    throw new Error(
      "That public ID already exists. Use --existing to analyze it, or --overwrite to replace it.",
    );
  return result;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      existing: { type: "boolean" },
      overwrite: { type: "boolean" },
      "public-id": { type: "string" },
      sizes: { type: "string" },
      alt: { type: "string" },
      "min-width": { type: "string" },
      "max-width": { type: "string" },
      "bytes-step": { type: "string" },
      "max-images": { type: "string" },
    },
  });
  if (values.help) {
    console.log(
      'Upload: npm run cloudinary:breakpoints -- "src/images/blog/photo.jpg" --alt="Description"\nExisting asset: npm run cloudinary:breakpoints -- "images/blog/photo" --existing\nOptions: --public-id=ID --sizes=CSS --min-width=50 --max-width=1920 --bytes-step=20000 --max-images=20 --overwrite',
    );
    return;
  }
  if (positionals.length !== 1)
    throw new Error("Supply one image path or public ID. Use --help for examples.");
  if (values.existing && values.overwrite)
    throw new Error("--existing and --overwrite cannot be combined.");
  // .env.local overrides .env; actual process environment overrides both.
  let env = {};
  for (const name of [".env", ".env.local"]) {
    const path = resolve(root, name);
    if (existsSync(path)) env = { ...env, ...parseEnv(await readFile(path, "utf8")) };
  }
  env = { ...env, ...process.env };
  const cloudName =
    env.PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() || env.CLOUDINARY_CLOUD_NAME?.trim() || DEFAULT_CLOUD;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret)
    throw new Error(
      "Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to .env.local first. See CLOUDINARY.md.",
    );
  const file = values.existing ? undefined : resolve(positionals[0]);
  if (file && !(await stat(file)).isFile()) throw new Error("The upload path must be a file.");
  const localId = file
    ? relative(root, file)
        .replaceAll("\\", "/")
        .replace(/^(?:src|public)\//, "")
        .slice(0, -extname(file).length || undefined)
    : positionals[0];
  const publicId = values["public-id"] || localId;
  if (
    !publicId ||
    isAbsolute(publicId) ||
    publicId.split("/").some((part) => !part || part === "." || part === "..") ||
    /[?&#%<>]/.test(publicId)
  ) {
    throw new Error(
      'Use --public-id="images/blog/photo" for an image outside this project, or to choose a safe asset ID.',
    );
  }
  const requests = breakpointRequests({
    minWidth: Number(values["min-width"] ?? 50),
    maxWidth: Number(values["max-width"] ?? 1920),
    bytesStep: Number(values["bytes-step"] ?? 20000),
    maxImages: Number(values["max-images"] ?? 20),
  });
  console.log(
    `${file ? "Uploading" : "Analyzing"} "${publicId}" in ${cloudName}; requesting JXL, AVIF and WebP breakpoints...`,
  );
  let result;
  try {
    result = await requestCloudinary({
      cloudName,
      apiKey,
      apiSecret,
      publicId,
      file,
      overwrite: values.overwrite,
      requests,
    });
  } catch (error) {
    throw new Error(
      String(error.message).replaceAll(apiSecret, "[redacted]").replaceAll(apiKey, "[redacted]"),
    );
  }
  const asset = assetFromResponse(result, cloudName, values.sizes || PROSE_SIZES);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest[`${cloudName}/${asset.publicId}`] = asset;
  const temporary = `${manifestPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n");
  await rename(temporary, manifestPath);
  console.log("Saved src/data/cloudinary-images.json. Paste this into a Markdown post:\n");
  console.log(
    `<cloudinary-picture src="${escapeAttribute(asset.publicId)}" cloud-name="${cloudName}" alt="${escapeAttribute(values.alt ?? "Describe this image")}" width="${asset.width}" height="${asset.height}" sizes="${escapeAttribute(asset.sizes)}"></cloudinary-picture>`,
  );
  console.log(
    `\nFor a post cover, use:\ncoverImage: ${JSON.stringify(asset.publicId)}\ncoverAlt: ${JSON.stringify(values.alt ?? "Describe this image")}\ncoverCloudName: ${JSON.stringify(cloudName)}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Cloudinary: ${error.message}`);
    process.exitCode = 1;
  });
}
