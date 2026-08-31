import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AuditEvent, AuditRecord } from "@perch/core";

const s3 = new S3Client({});
const AUDIT_BUCKET_NAME = process.env.AUDIT_BUCKET_NAME ?? "";
/** Matches the bucket's Object Lock default retention (see infra/sst.config.ts) — kept in sync there. */
const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? 365);

export function computeHash(prevHash: string, event: AuditEvent) {
  return createHash("sha256").update(prevHash).update(JSON.stringify(event)).digest("hex");
}

export async function writeAuditRecord(record: AuditRecord) {
  const date = new Date(record.event.occurredAt);
  const key = [
    record.event.workspaceId,
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    `${String(record.seq).padStart(12, "0")}-${record.event.id}.json`,
  ].join("/");

  await s3.send(
    new PutObjectCommand({
      Bucket: AUDIT_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(record, null, 2),
      ContentType: "application/json",
      ObjectLockMode: "COMPLIANCE",
      ObjectLockRetainUntilDate: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
    }),
  );
  return key;
}
