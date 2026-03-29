#!/usr/bin/env node

const fs = require('fs/promises');
const path = require('path');

const DEFAULT_INTAKE_DIR = '/Users/dollyshahani/Documents/Playground/serafina-intake';
const DEFAULT_WORKSPACE = 'serafina-main';
const DEFAULT_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'serafina-assets';

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
  const bytes = await fs.readFile(filePath);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const objectPath = `${lane}/${Date.now()}-${safeName}`;
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/octet-stream',
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
      const uploaded = await uploadFile(supabaseUrl, serviceKey, bucket, rule.lane, filePath, fileName);
      const item = {
        id: uid(),
        type: inferType(fileName),
        title: titleFromFilename(fileName) || folderLabel || 'Untitled asset',
        folderName: folderLabel,
        importPath: `${folderName}/${relativeFilePath}`,
        event: '',
        date: today(),
        notes: `Imported from local intake folder: ${folderName}/${relativeFilePath}`,
        status: 'raw',
        lane: rule.lane,
        owner: rule.owner,
        adReady: false,
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
