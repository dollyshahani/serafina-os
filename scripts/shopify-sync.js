const fs = require('fs');
const path = require('path');

const SHOPIFY_SNAPSHOT_KEY = 'sf3_shopify_snapshot';
const CUSTOMERS_KEY = 'sf3_customers';

function argValue(flag, fallback = '') {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? (process.argv[idx + 1] || fallback) : fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function parseCsvLine(line) {
  return line.match(/(".*?"|[^,]+|(?<=,)(?=,))/g) || line.split(',');
}

function normalizeDateString(input) {
  const dt = new Date(input);
  if (Number.isNaN(dt.getTime())) return '';
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isShopifyOrdersCsv(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const firstLine = text.split('\n')[0] || '';
    const headers = parseCsvLine(firstLine).map(h => h.replace(/["\r]/g, '').trim().toLowerCase());
    const hasName = headers.some(h => h.includes('name'));
    const hasEmail = headers.some(h => h.includes('email'));
    const hasTotal = headers.some(h => h.includes('total'));
    const hasCreated = headers.some(h => h.includes('created'));
    return hasName && hasEmail && hasTotal && hasCreated;
  } catch (_) {
    return false;
  }
}

function latestShopifyCsv(downloadsDir) {
  const files = fs.readdirSync(downloadsDir)
    .filter(name => name.toLowerCase().endsWith('.csv'))
    .map(name => path.join(downloadsDir, name))
    .filter(filePath => {
      try {
        return fs.statSync(filePath).isFile() && isShopifyOrdersCsv(filePath);
      } catch (_) {
        return false;
      }
    })
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || '';
}

function buildImport(filePath, existingCustomersRaw) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const headers = parseCsvLine(lines[0] || '').map(h => h.replace(/["\r]/g, '').trim().toLowerCase());
  const col = key => headers.findIndex(h => h.includes(key));
  const nameCol = col('name');
  const emailCol = col('email');
  const totalCol = col('total');
  const phoneCol = col('phone');
  const cityCol = col('city');
  const dateCol = col('created');
  const orderIdCol = col('order');

  const customers = Array.isArray(existingCustomersRaw) ? existingCustomersRaw : [];
  const orders = [];
  let added = 0;
  let updated = 0;

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    const cols = parseCsvLine(raw);
    const c = idx => (cols[idx] || '').replace(/["\r]/g, '').trim();
    const name = c(nameCol);
    const email = c(emailCol);
    const phone = c(phoneCol);
    const city = c(cityCol);
    const total = parseFloat(c(totalCol)) || 0;
    const date = c(dateCol);
    const orderId = c(orderIdCol) || `shopify-row-${i}`;
    const customerKey = (email || phone || name || `row-${i}`).toLowerCase();
    if (!name && !email) continue;

    orders.push({ id: orderId, customerKey, total, date, name, email, phone, city });

    const found = customers.find(x => (email && x.email === email) || (phone && x.phone === phone));
    if (found) {
      found.totalSpend = (Number(found.totalSpend) || 0) + total;
      found.tag = found.tag || (total >= 5000 ? 'vip' : 'new');
      found.notes = [found.notes, 'Imported from Shopify orders CSV'].filter(Boolean).join(' · ');
      updated += 1;
    } else {
      customers.push({
        id: 'so_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        name,
        email,
        phone,
        city,
        showId: '',
        showName: 'Shopify Online',
        items: '',
        totalSpend: total,
        tag: total >= 5000 ? 'vip' : 'new',
        followUpDate: '',
        notes: 'Imported from Shopify orders CSV · First order ' + (date ? date.slice(0, 10) : new Date().toISOString().slice(0, 10))
      });
      added += 1;
    }
  }

  const now = new Date();
  const todayStr = normalizeDateString(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = normalizeDateString(yesterday);
  const seenBefore = new Set();
  let salesYesterday = 0;
  let ordersYesterday = 0;
  let repeatYesterday = false;
  let salesToday = 0;
  let ordersToday = 0;

  orders
    .filter(order => order.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach(order => {
      const orderDay = normalizeDateString(order.date);
      const isRepeat = seenBefore.has(order.customerKey);
      if (orderDay === yesterdayStr) {
        salesYesterday += order.total;
        ordersYesterday += 1;
        if (isRepeat) repeatYesterday = true;
      }
      if (orderDay === todayStr) {
        salesToday += order.total;
        ordersToday += 1;
      }
      seenBefore.add(order.customerKey);
    });

  return {
    customers,
    added,
    updated,
    snapshot: {
      source: 'shopify-csv',
      importedAt: new Date().toISOString(),
      salesYesterday,
      ordersYesterday,
      repeatYesterday,
      salesToday,
      ordersToday,
      ordersTotal: orders.length
    }
  };
}

async function fetchCloudSnapshot(cloudBaseUrl, workspace) {
  const resp = await fetch(`${cloudBaseUrl}/api/cloud/pull?workspace=${encodeURIComponent(workspace)}`, { cache: 'no-store' });
  if (resp.status === 404) return {};
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Cloud pull failed');
  return data.snapshot || {};
}

async function pushCloudSnapshot(cloudBaseUrl, workspace, snapshot) {
  const resp = await fetch(`${cloudBaseUrl}/api/cloud/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace, snapshot })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || 'Cloud push failed');
  return data;
}

async function main() {
  const workspace = argValue('--workspace', 'serafina-main');
  const downloadsDir = argValue('--downloads-dir', path.join(process.env.HOME || '', 'Downloads'));
  const cloudBaseUrl = argValue('--cloud-base-url', 'https://serafina-os-vercel.vercel.app');
  const explicitFile = argValue('--file', '');
  const json = hasFlag('--json');

  const filePath = explicitFile || latestShopifyCsv(downloadsDir);
  if (!filePath) throw new Error('No Shopify orders CSV found in Downloads.');

  const cloudSnapshot = await fetchCloudSnapshot(cloudBaseUrl, workspace);
  let existingCustomers = [];
  try {
    existingCustomers = JSON.parse(cloudSnapshot[CUSTOMERS_KEY] || '[]');
  } catch (_) {
    existingCustomers = [];
  }

  const result = buildImport(filePath, existingCustomers);
  const nextSnapshot = {
    ...cloudSnapshot,
    [CUSTOMERS_KEY]: JSON.stringify(result.customers),
    [SHOPIFY_SNAPSHOT_KEY]: JSON.stringify(result.snapshot)
  };
  await pushCloudSnapshot(cloudBaseUrl, workspace, nextSnapshot);

  const output = {
    ok: true,
    workspace,
    file: filePath,
    added: result.added,
    updated: result.updated,
    snapshot: result.snapshot
  };
  if (json) {
    console.log(JSON.stringify(output));
  } else {
    console.log(`Synced ${path.basename(filePath)} -> ${workspace}`);
    console.log(`${result.added} new customers, ${result.updated} updated`);
  }
}

main().catch(err => {
  const payload = { ok: false, error: err.message };
  if (hasFlag('--json')) {
    console.log(JSON.stringify(payload));
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
