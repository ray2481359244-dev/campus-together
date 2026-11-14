import sharp from 'sharp';

export async function normalizePhoto(bytes: Buffer, maxSide: number, quality: number) {
  const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
  const meta = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || !meta.width || !meta.height || meta.width > 8000 || meta.height > 8000 || (meta.pages ?? 1) > 1) {
    throw new Error('Unsupported still image');
  }
  // Sharp writes fresh WebP and drops EXIF, including GPS, by default.
  return image.rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .webp({ quality }).toBuffer({ resolveWithObject: true });
}
