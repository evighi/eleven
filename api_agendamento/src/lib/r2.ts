// src/lib/r2.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import path from "path";
import crypto from "crypto";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export function r2PublicUrl(key?: string | null) {
  if (!key) return null;
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

export async function uploadToR2(params: {
  buffer: Buffer;
  contentType: string;
  originalName: string;
  prefix: "quadras" | "esportes" | "churrasqueiras";
}) {
  const ext = path.extname(params.originalName) || "";
  const key = `${params.prefix}/${Date.now()}-${crypto.randomUUID()}${ext.toLowerCase()}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: key,
      Body: params.buffer,
      ContentType: params.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );

  return { key, url: r2PublicUrl(key)! };
}

export async function deleteFromR2(key?: string | null) {
  if (!key) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }));
  } catch {
    // ok ignorar
  }
}
