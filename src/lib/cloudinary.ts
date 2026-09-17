import { randomBytes } from 'crypto';

// CV PDFs are stored on Cloudinary (raw assets) instead of as multi-MB Buffer
// blobs inside Mongo — keeping the database small and fast as users grow.
// Implemented over Cloudinary's plain REST API with global fetch — no SDK (the
// `cloudinary` npm package hangs at require() in this toolchain, and this
// account rejects HMAC-SHA1 upload signatures despite a valid api_secret, i.e.
// asymmetric signing is enabled). So uploads go through an unsigned upload
// PRESET (server-side only; not exposed to browsers), created via the admin
// API as `prime-cv-uploads`. Deletion uses Basic auth + admin destroy.
// Env vars: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
// (set in server/.env or as platform env vars on Render) and optionally
// CLOUDINARY_UPLOAD_PRESET (defaults to 'prime-cv-uploads').

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const API_KEY = process.env.CLOUDINARY_API_KEY || '';
const API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'prime-cv-uploads';

const API_BASE_URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}`;
const CV_FOLDER = 'prime-opportunity/cvs';
const BASIC_AUTH = 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

export interface CvStoredFile {
  cloudinaryId: string;
  cloudinaryUrl: string;
}

const isConfigured = (): boolean => Boolean(CLOUD_NAME && API_KEY && API_SECRET);

// Upload a CV PDF's bytes as a `raw` asset (PDFs keep their extension/serving).
// public_id is deterministic-free (random suffix) so re-uploads never collide;
// old assets are cleaned up separately via replaceSameFile/deleteCV.
// Throws on failure so callers can fall back to the in-Mongo buffer.
export const uploadCvPdf = async (buffer: Buffer, originalName: string): Promise<CvStoredFile> => {
  if (!isConfigured()) throw new Error('Cloudinary is not configured (missing env vars).');

  const cleanName = (originalName || 'cv.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 40);
  const publicId = `${Date.now()}-${randomBytes(4).toString('hex')}-${cleanName}`;

  const body = new URLSearchParams({
    upload_preset: UPLOAD_PRESET,
    folder: CV_FOLDER,
    public_id: publicId.replace(/\.[a-zA-Z0-9]+$/, ''),
    file: `data:application/pdf;base64,${buffer.toString('base64')}`,
  });

  const res = await fetch(`${API_BASE_URL}/raw/upload`, {
    method: 'POST',
    headers: { Authorization: BASIC_AUTH },
    body,
  });
  const bodyJson: any = await res.json().catch(() => ({}));
  if (!res.ok || !bodyJson?.public_id) {
    throw new Error(
      `Cloudinary upload failed (HTTP ${res.status}): ${bodyJson?.error?.message || res.statusText || 'unknown'}`
    );
  }

  return {
    cloudinaryId: bodyJson.public_id,
    cloudinaryUrl:
      bodyJson.secure_url ||
      `https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${bodyJson.public_id}`,
  };
};

// Best-effort removal of a CV's raw asset from Cloudinary. Never throws.
export const destroyCvPdf = async (publicId: string): Promise<void> => {
  try {
    if (!isConfigured()) return;
    const body = new URLSearchParams({ public_id: publicId });
    const res = await fetch(`${API_BASE_URL}/raw/destroy`, {
      method: 'POST',
      headers: {
        Authorization: BASIC_AUTH,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) {
      console.error(
        'Cloudinary destroy failed (best-effort):',
        res.status,
        await res.text().catch(() => '')
      );
    }
  } catch (error) {
    console.error('Cloudinary destroy failed (best-effort):', error);
  }
};