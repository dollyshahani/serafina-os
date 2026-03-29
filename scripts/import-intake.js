#!/usr/bin/env node

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const tus = require('tus-js-client');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_INTAKE_DIR = '/Users/dollyshahani/Documents/Playground/serafina-intake';
const DEFAULT_WORKSPACE = 'serafina-main';
const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'serafina-assets';
const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024;

const folderRules = {
  'serafina-raw': { lane: 'serafina', owner: 'Kriti', sourceLabel: 'Local Intake / Serafina' },
  'founder-raw': { lane: 'personal', owner: 'Kriti', sourceLabel: 'Local Intake / Founder' },
  'needs-review': { lane: 'both', owner: 'Me', sourceLabel: 'Local Intake / Review' }
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrow() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inferType(fileName = '') {
  const name = fileName.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif|heic|heif)$/i.test(name)) return 'photo';
  if (/\.(mov|mp4|m4v|avi|mkv)$/i.test(name)) return 'b-roll';
  return 'a-roll';
}

function isImportable(fileName = '') {
  return /\.(jpg|jpeg|png|webp|gif|heic|heif|mov|mp4|m4v|avi|mkv)$/i.test(fileName);
}

function titleFromFilename(name = '') {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function primaryFolderName(relativeFilePath = '') {
  const segments = relativeFilePath.split(path.sep).filter(Boolean);
  return segments.length > 1 ? segments[0] : 'Ungrouped';
}

function defaultAudience(lane) {
  if (lane === 'personal') return 'Founder-facing';
  if (lane === 'both') return 'Both';
  return 'Brand-facing';
}

function buildImportedInstructions(lane, folderLabel) {
  const laneNote = lane === 'personal'
    ? 'Keep it founder-facing, emotionally strong, and real.'
    : lane === 'both'
      ? 'Make one founder-facing version and one brand-facing version if possible.'
      : 'Keep it premium, clean, soft-luxe, and Serafina-forward.';
  return [
    'Deadline: within 24 hours.',
    `Batch: ${folderLabel}.`,
    'Pick only the strongest clips.',
    'Build a first-3-seconds hook.',
    'Edit with a clear story arc: hook -> detail -> payoff -> CTA.',
    'Use top-notch editing, tasteful text overlays, and premium storytelling.',
    laneNote,
    'Upload finals back into the app and move status to Ready for Dolly.'
  ].join(' ');
}

async function ensureBucket(supabaseUrl, serviceKey, bucket) {
  const resp = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    },
    body: JSON.stringify({ id: bucket, name: bucket, public: true })
  });
  if (resp.ok) return;
  const text = await resp.text();
  if (resp.status === 409 || /already exists/i.test(text)) return;
  throw new Error(text || `Bucket create failed (${resp.status})`);
}

async function fetchSnapshot(supabaseUrl, serviceKey, workspace) {
  const resp = await fetch(`${supabaseUrl}/rest/v1/app_snapshots?workspace=eq.${encodeURIComponent(workspace)}&select=workspace,payload,updated_at&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    }
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Snapshot fetch failed (${resp.status})`);
  }
  const rows = await resp.json();
  return {
    exists: Boolean(rows[0]),
    payload: rows[0]?.payload || {}
  };
}

async function saveSnapshot(supabaseUrl, serviceKey, workspace, payload, exists) {
  const patchResp = await fetch(`${supabaseUrl}/rest/v1/app_snapshots?workspace=eq.${encodeURIComponent(workspace)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      payload,
      updated_at: new Date().toISOString()
    })
  });
  if (!patchResp.ok) {
    const text = await patchResp.text();
    throw new Error(text || `Snapshot save failed (${patchResp.status})`);
  }
  const patched = await patchResp.json();
  if (patched.length) return;
  if (exists) throw new Error('Snapshot update returned no rows.');

  const createResp = await fetch(`${supabaseUrl}/rest/v1/app_snapshots`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=representation'
    },
    body: JSON.stringify([{
      workspace,
      payload,
      updated_at: new Date().toISOString()
    }])
  });
  if (!createResp.ok) {
    const text = await createResp.text();
    throw new Error(text || `Snapshot create failed (${createResp.status})`);
  }
}

async function uploadFile(supabaseUrl, serviceKey, bucket, lane, filePath, fileName) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const objectPath = `${lane}/${Date.now()}-${safeName}`;
  const stat = await fs.stat(filePath);
  const lowerName = fileName.toLowerCase();
  const contentType = lowerName.endsWith('.mov') ? 'video/quicktime'
    : lowerName.endsWith('.mp4') || lowerName.endsWith('.m4v') ? 'video/mp4'
    : lowerName.endsWith('.avi') ? 'video/x-msvideo'
    : lowerName.endsWith('.mkv') ? 'video/x-matroska'
    : lowerName.endsWith('.png') ? 'image/png'
    : lowerName.endsWith('.webp') ? 'image/webp'
    : lowerName.endsWith('.gif') ? 'image/gif'
    : (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) ? 'image/jpeg'
    : 'application/octet-stream';

  if (stat.size > RESUMABLE_THRESHOLD_BYTES) {
    const directHost = new URL(supabaseUrl).hostname.replace('.supabase.co', '.storage.supabase.co');
    const endpoint = `https://${directHost}/storage/v1/upload/resumable`;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(objectPath, { upsert: true });
    if (error || !data?.token) throw new Error(error?.message || 'Could not create signed upload token');
    await new Promise((resolve, reject) => {
      const upload = new tus.Upload(fsSync.createReadStream(filePath), {
        endpoint,
        uploadSize: stat.size,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          authorization: `Bearer ${data.token}`
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: bucket,
          objectName: objectPath,
          contentType,
          cacheControl: '3600'
        },
        chunkSize: 6 * 1024 * 1024,
        onError: reject,
        onSuccess: resolve
      });

      upload.findPreviousUploads().then(previousUploads => {
        if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      }).catch(reject);
    });
    return {
      path: objectPath,
      publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
    };
  }

  const bytes = await fs.readFile(filePath);
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': contentType,
      'x-upsert': 'true'
    },
    body: bytes
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `Upload failed (${resp.status})`);
  }
  return {
    path: objectPath,
    publicUrl: `${supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`
  };
}

async function moveToImported(intakeDir, sourceFolder, relativeFilePath, fromPath) {
  const importedDir = path.join(intakeDir, 'imported', sourceFolder, path.dirname(relativeFilePath));
  await fs.mkdir(importedDir, { recursive: true });
  const target = path.join(importedDir, `${Date.now()}-${path.basename(relativeFilePath)}`);
  await fs.rename(fromPath, target);
  return target;
}

async function listFilesRecursive(folderPath, prefix = '') {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(folderPath, entry.name);
    const relPath = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(entryPath, relPath));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const intakeDir = path.resolve(args['intake-dir'] || DEFAULT_INTAKE_DIR);
  const workspace = String(args.workspace || DEFAULT_WORKSPACE).trim();
  const replaceContent = Boolean(args['replace-content']);
  const jsonOutput = Boolean(args.json);
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET;

  if (!supabaseUrl || !serviceKey) fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running the importer.');
  if (!workspace) fail('Workspace is required.');

  await ensureBucket(supabaseUrl, serviceKey, bucket);

  const snapshotState = await fetchSnapshot(supabaseUrl, serviceKey, workspace);
  const snapshot = snapshotState.payload || {};
  const rawContent = replaceContent ? '[]' : (snapshot.sf3_content || '[]');
  let contentItems;
  try {
    contentItems = JSON.parse(rawContent);
    if (!Array.isArray(contentItems)) contentItems = [];
  } catch (_) {
    contentItems = [];
  }

  const imported = [];
  const skipped = [];
  const pendingMoves = [];
  for (const [folderName, rule] of Object.entries(folderRules)) {
    const folderPath = path.join(intakeDir, folderName);
    const files = await listFilesRecursive(folderPath).catch(() => []);
    for (const relativeFilePath of files) {
      const filePath = path.join(folderPath, relativeFilePath);
      const fileName = path.basename(relativeFilePath);
      if (!isImportable(fileName)) {
        if (!jsonOutput) console.log(`Skipped ${folderName}/${relativeFilePath}`);
        continue;
      }
      const folderLabel = primaryFolderName(relativeFilePath);
      let uploaded;
      try {
        uploaded = await uploadFile(supabaseUrl, serviceKey, bucket, rule.lane, filePath, fileName);
      } catch (err) {
        if (/413|Payload too large/i.test(err.message)) {
          skipped.push({ fileName: `${folderName}/${relativeFilePath}`, reason: 'payload too large' });
          if (!jsonOutput) console.log(`Skipped ${folderName}/${relativeFilePath} (payload too large)`);
          continue;
        }
        throw err;
      }
      const item = {
        id: uid(),
        type: inferType(fileName),
        title: titleFromFilename(fileName) || folderLabel || 'Untitled asset',
        folderName: folderLabel,
        importPath: `${folderName}/${relativeFilePath}`,
        event: folderLabel,
        date: today(),
        deadline: tomorrow(),
        notes: `Imported from local intake folder: ${folderName}/${relativeFilePath}`,
        status: 'raw',
        lane: rule.lane,
        owner: rule.owner,
        adReady: false,
        audience: defaultAudience(rule.lane),
        hook: '',
        adAngle: '',
        instructions: buildImportedInstructions(rule.lane, folderLabel),
        source: rule.sourceLabel,
        link: uploaded.publicUrl,
        img: inferType(fileName) === 'photo' ? uploaded.publicUrl : null,
      };
      contentItems.push(item);
      pendingMoves.push({ intakeDir, folderName, relativeFilePath, filePath, lane: rule.lane, publicUrl: uploaded.publicUrl });
      if (!jsonOutput) console.log(`Uploaded ${folderName}/${relativeFilePath}`);
    }
  }

  snapshot.sf3_content = JSON.stringify(contentItems);
  await saveSnapshot(supabaseUrl, serviceKey, workspace, snapshot, snapshotState.exists);

  for (const entry of pendingMoves) {
    const archivedTo = await moveToImported(entry.intakeDir, entry.folderName, entry.relativeFilePath, entry.filePath);
    imported.push({
      fileName: entry.relativeFilePath,
      folderName: entry.folderName,
      lane: entry.lane,
      archivedTo,
      publicUrl: entry.publicUrl
    });
  }

  const report = {
    importedAt: new Date().toISOString(),
    workspace,
    bucket,
    count: imported.length,
    skippedCount: skipped.length,
    skipped,
    files: imported
  };
  const reportPath = path.join(intakeDir, 'imported', `import-report-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

  if (jsonOutput) {
    console.log(JSON.stringify({ ok: true, ...report, replaceContent, reportPath }));
  } else {
    console.log(`\n✅ Imported ${imported.length} files into workspace "${workspace}"${replaceContent ? ' (replace mode)' : ''}.`);
    console.log(`Report: ${reportPath}`);
    console.log('Next: open Serafina OS -> Cloud Sync -> Pull Cloud');
  }
}

main().catch(err => fail(err.message));
