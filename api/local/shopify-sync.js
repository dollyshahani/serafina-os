const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { sendJson } = require('../_lib/http');

const execFileAsync = promisify(execFile);

module.exports = async function handler(req, res) {
  if (process.env.VERCEL === '1') {
    return sendJson(res, 400, { error: 'Local Shopify pull only works on your Mac.' });
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}');
    const workspace = String(body.workspace || 'serafina-main').trim();
    const downloadsDir = String(body.downloadsDir || path.join(process.env.HOME || '', 'Downloads')).trim();
    const cloudBaseUrl = String(body.cloudBaseUrl || 'https://serafina-os-vercel.vercel.app').trim();
    const scriptPath = path.join(process.cwd(), 'scripts', 'shopify-sync.js');
    const { stdout } = await execFileAsync('node', [scriptPath, '--workspace', workspace, '--downloads-dir', downloadsDir, '--cloud-base-url', cloudBaseUrl, '--json'], {
      env: process.env,
      maxBuffer: 10 * 1024 * 1024
    });
    const data = JSON.parse((stdout || '').trim().split('\n').filter(Boolean).pop() || '{}');
    sendJson(res, 200, data);
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
