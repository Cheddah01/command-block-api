// command-block-api
// Current production Worker code. Lives only in Cloudflare dashboard.
// Bindings:
//   env.FILES → R2 bucket "command-block-files"
//   env.DB    → D1 database "command-block-db"
//
// Deployed at: https://command-block-api.colbysthickey.workers.dev
// Protected by Cloudflare Access (GitHub OAuth, allows choder01@pm.me)

const ALLOWED_ORIGINS = new Set([
  'https://command-block.pages.dev',
  'https://cheddah01.github.io',
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const origin = request.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin)
        ? origin
        : 'https://command-block.pages.dev',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    try {
      // ============ PLUGINS ============

      if (path === '/plugins' && method === 'GET') {
        const { results } = await env.DB.prepare(
          'SELECT * FROM plugins ORDER BY uploaded_at DESC'
        ).all();
        return json(results, cors);
      }

      if (path === '/plugins' && method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        const name = formData.get('name') || file.name.replace(/\.jar$/, '');
        const version = formData.get('version') || '';
        const notes = formData.get('notes') || '';

        if (!file) return error('No file provided', 400, cors);

        const r2_key = `jars/${Date.now()}-${file.name}`;
        await env.FILES.put(r2_key, file.stream());

        const result = await env.DB.prepare(
          'INSERT INTO plugins (name, version, filename, r2_key, size_bytes, notes) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(name, version, file.name, r2_key, file.size, notes).run();

        return json({ ok: true, id: result.meta.last_row_id }, cors);
      }

      const downloadMatch = path.match(/^\/plugins\/(\d+)\/download$/);
      if (downloadMatch && method === 'GET') {
        const id = downloadMatch[1];
        const row = await env.DB.prepare(
          'SELECT * FROM plugins WHERE id = ?'
        ).bind(id).first();
        if (!row) return error('Not found', 404, cors);
        const obj = await env.FILES.get(row.r2_key);
        if (!obj) return error('File missing in storage', 404, cors);
        return new Response(obj.body, {
          headers: {
            ...cors,
            'Content-Type': 'application/java-archive',
            'Content-Disposition': `attachment; filename="${row.filename}"`,
          },
        });
      }

      const pluginDeleteMatch = path.match(/^\/plugins\/(\d+)$/);
      if (pluginDeleteMatch && method === 'DELETE') {
        const id = pluginDeleteMatch[1];
        const row = await env.DB.prepare(
          'SELECT r2_key FROM plugins WHERE id = ?'
        ).bind(id).first();
        if (!row) return error('Not found', 404, cors);
        await env.FILES.delete(row.r2_key);
        await env.DB.prepare('DELETE FROM plugins WHERE id = ?').bind(id).run();
        return json({ ok: true }, cors);
      }

      // ============ CONFIGS ============

      if (path === '/configs' && method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT c.id, c.name, c.plugin, c.current_version_id, c.updated_at,
                 (SELECT COUNT(*) FROM config_versions WHERE config_id = c.id) AS version_count
          FROM configs c
          ORDER BY c.updated_at DESC
        `).all();
        return json(results, cors);
      }

      if (path === '/configs' && method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file');
        const name = formData.get('name') || (file && file.name);
        const plugin = formData.get('plugin') || '';

        if (!name) return error('Name required', 400, cors);

        let content;
        if (file) {
          content = await file.text();
        } else {
          content = formData.get('content') || '';
        }

        const cfg = await env.DB.prepare(
          'INSERT INTO configs (name, plugin) VALUES (?, ?)'
        ).bind(name, plugin).run();
        const config_id = cfg.meta.last_row_id;

        const ver = await env.DB.prepare(
          'INSERT INTO config_versions (config_id, content, note) VALUES (?, ?, ?)'
        ).bind(config_id, content, 'initial upload').run();

        await env.DB.prepare(
          'UPDATE configs SET current_version_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).bind(ver.meta.last_row_id, config_id).run();

        return json({ ok: true, id: config_id }, cors);
      }

      const cfgGetMatch = path.match(/^\/configs\/(\d+)$/);
      if (cfgGetMatch && method === 'GET') {
        const id = cfgGetMatch[1];
        const cfg = await env.DB.prepare(
          'SELECT * FROM configs WHERE id = ?'
        ).bind(id).first();
        if (!cfg) return error('Not found', 404, cors);

        const ver = await env.DB.prepare(
          'SELECT * FROM config_versions WHERE id = ?'
        ).bind(cfg.current_version_id).first();

        return json({ ...cfg, content: ver ? ver.content : '' }, cors);
      }

      if (cfgGetMatch && method === 'PUT') {
        const id = cfgGetMatch[1];
        const body = await request.json();
        const content = body.content || '';
        const note = body.note || '';

        const ver = await env.DB.prepare(
          'INSERT INTO config_versions (config_id, content, note) VALUES (?, ?, ?)'
        ).bind(id, content, note).run();

        await env.DB.prepare(
          'UPDATE configs SET current_version_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).bind(ver.meta.last_row_id, id).run();

        return json({ ok: true, version_id: ver.meta.last_row_id }, cors);
      }

      if (cfgGetMatch && method === 'DELETE') {
        const id = cfgGetMatch[1];
        await env.DB.prepare('DELETE FROM config_versions WHERE config_id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM configs WHERE id = ?').bind(id).run();
        return json({ ok: true }, cors);
      }

      const cfgVersionsMatch = path.match(/^\/configs\/(\d+)\/versions$/);
      if (cfgVersionsMatch && method === 'GET') {
        const id = cfgVersionsMatch[1];
        const { results } = await env.DB.prepare(
          'SELECT id, note, created_at FROM config_versions WHERE config_id = ? ORDER BY created_at DESC'
        ).bind(id).all();
        return json(results, cors);
      }

      const cfgVerOneMatch = path.match(/^\/configs\/(\d+)\/versions\/(\d+)$/);
      if (cfgVerOneMatch && method === 'GET') {
        const vid = cfgVerOneMatch[2];
        const ver = await env.DB.prepare(
          'SELECT * FROM config_versions WHERE id = ?'
        ).bind(vid).first();
        if (!ver) return error('Version not found', 404, cors);
        return json(ver, cors);
      }

      const cfgRestoreMatch = path.match(/^\/configs\/(\d+)\/restore\/(\d+)$/);
      if (cfgRestoreMatch && method === 'POST') {
        const id = cfgRestoreMatch[1];
        const vid = cfgRestoreMatch[2];

        const old = await env.DB.prepare(
          'SELECT content FROM config_versions WHERE id = ? AND config_id = ?'
        ).bind(vid, id).first();
        if (!old) return error('Version not found', 404, cors);

        const ver = await env.DB.prepare(
          'INSERT INTO config_versions (config_id, content, note) VALUES (?, ?, ?)'
        ).bind(id, old.content, `restored from version ${vid}`).run();

        await env.DB.prepare(
          'UPDATE configs SET current_version_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).bind(ver.meta.last_row_id, id).run();

        return json({ ok: true, version_id: ver.meta.last_row_id }, cors);
      }

      const cfgDownloadMatch = path.match(/^\/configs\/(\d+)\/download$/);
      if (cfgDownloadMatch && method === 'GET') {
        const id = cfgDownloadMatch[1];
        const cfg = await env.DB.prepare(
          'SELECT * FROM configs WHERE id = ?'
        ).bind(id).first();
        if (!cfg) return error('Not found', 404, cors);

        const ver = await env.DB.prepare(
          'SELECT * FROM config_versions WHERE id = ?'
        ).bind(cfg.current_version_id).first();

        const filename = cfg.name.endsWith('.yml') ? cfg.name : `${cfg.name}.yml`;
        return new Response(ver ? ver.content : '', {
          headers: {
            ...cors,
            'Content-Type': 'text/yaml',
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        });
      }

      // ============ HEALTH ============

      if (path === '/' && method === 'GET') {
        return json({ ok: true, service: 'command-block-api' }, cors);
      }

      return error('Not found', 404, cors);
    } catch (err) {
      return error(err.message, 500, cors);
    }
  },
};

function json(data, cors) {
  return new Response(JSON.stringify(data), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function error(message, status, cors) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
