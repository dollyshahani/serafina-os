const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { sendJson } = require('../_lib/http');

const execFileAsync = promisify(execFile);

module.exports = async function handler(req, res) {
  if (process.env.VERCEL === '1') {
    return sendJson(res, 400, { error: 'Local intake sync only works on your local machine.' });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    const folder = String(body.folder || 'serafina-raw').trim();
    const workspace = String(body.workspace || 'serafina-main').trim();
    const replaceContent = body.replaceContent === true;
    if (!['serafina-raw', 'founder-raw', 'needs-review'].includes(folder)) {
      return sendJson(res, 400, { error: 'Unsupported intake folder.' });
    }

    const intakeRoot = '/Users/dollyshahani/Documents/Playground/serafina-intake';
    const scriptPath = path.join(process.cwd(), 'scripts', 'import-intake.js');
    const args = ['--intake-dir', intakeRoot, '--workspace', workspace, '--json'];
    if (replaceContent) args.push('--replace-content');

    const tmpRoot = path.join('/tmp', `serafina-local-intake-${Date.now()}`);
    const tmpFolder = path.join(tmpRoot, folder);
    await execFileAsync('mkdir', ['-p', tmpFolder]);
    await execFileAsync('cp', ['-R', `${path.join(intakeRoot, folder)}/.`, tmpFolder]);
    await execFileAsync('mkdir', ['-p', path.join(tmpRoot, 'serafina-raw'), path.join(tmpRoot, 'founder-raw'), path.join(tmpRoot, 'needs-review'), path.join(tmpRoot, 'imported')]);

    const { stdout } = await execFileAsync('node', [scriptPath, '--intake-dir', tmpRoot, '--workspace', workspace, ...(replaceContent ? ['--replace-content'] : []), '--json'], {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });
    const data = JSON.parse((stdout || '').trim().split('\n').filter(Boolean).pop() || '{}');
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
