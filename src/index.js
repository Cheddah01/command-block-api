// command-block-api
// Current production Worker code. Lives only in Cloudflare dashboard.
// Bindings:
//   env.FILES → R2 bucket "command-block-files"
//   env.DB    → D1 database "command-block-db"
//
// Deployed at: https://command-block-api.colbysthickey.workers.dev
// Protected by Cloudflare Access (GitHub OAuth, allows choder01@pm.me)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const requestedHeaders = request.headers.get('Access-Control-Request-Headers');
    const cors = {
      'Access-Control-Allow-Origin': 'https://command-block.pages.dev',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': requestedHeaders || 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin, Access-Control-Request-Headers',
    };

    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Max-Age': '86400' },
      });
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

      // ============ ADMIN: PUBLISHED PLUGINS ============

      if (path === '/admin/published' && method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT p.id, p.slug, p.name, p.tagline, p.mc_versions,
                 p.current_version_id, p.created_at, p.updated_at,
                 (SELECT COUNT(*) FROM published_versions WHERE plugin_id = p.id) AS version_count,
                 (SELECT version FROM published_versions WHERE id = p.current_version_id) AS current_version
          FROM published_plugins p
          ORDER BY p.updated_at DESC
        `).all();
        return json(results, cors);
      }

      if (path === '/admin/published' && method === 'POST') {
        const body = await request.json();
        const { slug, name, tagline, description_md, mc_versions, source_url, support_url } = body;
        if (!slug || !name) return error('slug and name required', 400, cors);
        if (!/^[a-z0-9_-]+$/.test(slug)) return error('invalid slug (lowercase letters, digits, hyphens, underscores)', 400, cors);

        const result = await env.DB.prepare(`
          INSERT INTO published_plugins (slug, name, tagline, description_md, mc_versions, source_url, support_url)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(slug, name, tagline || null, description_md || null, mc_versions || null, source_url || null, support_url || null).run();

        return json({ ok: true, id: result.meta.last_row_id, slug }, cors);
      }

      const pubOneMatch = path.match(/^\/admin\/published\/([a-z0-9_-]+)$/);
      if (pubOneMatch && method === 'GET') {
        const slug = pubOneMatch[1];
        const plugin = await env.DB.prepare(
          'SELECT * FROM published_plugins WHERE slug = ?'
        ).bind(slug).first();
        if (!plugin) return error('Not found', 404, cors);

        const { results: versions } = await env.DB.prepare(`
          SELECT id, version, changelog_md, mc_version, filename, size_bytes, created_at
          FROM published_versions WHERE plugin_id = ? ORDER BY created_at DESC
        `).bind(plugin.id).all();

        return json({ ...plugin, versions }, cors);
      }

      if (pubOneMatch && method === 'PUT') {
        const slug = pubOneMatch[1];
        const body = await request.json();
        const { name, tagline, description_md, mc_versions, source_url, support_url } = body;

        const result = await env.DB.prepare(`
          UPDATE published_plugins
          SET name = COALESCE(?, name),
              tagline = COALESCE(?, tagline),
              description_md = COALESCE(?, description_md),
              mc_versions = COALESCE(?, mc_versions),
              source_url = COALESCE(?, source_url),
              support_url = COALESCE(?, support_url),
              updated_at = datetime('now')
          WHERE slug = ?
        `).bind(
          name ?? null,
          tagline ?? null,
          description_md ?? null,
          mc_versions ?? null,
          source_url ?? null,
          support_url ?? null,
          slug
        ).run();

        if (result.meta.changes === 0) return error('Not found', 404, cors);
        return json({ ok: true }, cors);
      }

      if (pubOneMatch && method === 'DELETE') {
        const slug = pubOneMatch[1];
        const plugin = await env.DB.prepare(
          'SELECT id FROM published_plugins WHERE slug = ?'
        ).bind(slug).first();
        if (!plugin) return error('Not found', 404, cors);

        // Collect every R2 key under published-jars/{slug}/, paginating if needed.
        const keys = [];
        let cursor;
        do {
          const list = await env.FILES.list({ prefix: `published-jars/${slug}/`, cursor });
          for (const obj of list.objects) keys.push(obj.key);
          cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);
        if (keys.length > 0) await env.FILES.delete(keys);

        await env.DB.prepare('DELETE FROM published_versions WHERE plugin_id = ?').bind(plugin.id).run();
        await env.DB.prepare('DELETE FROM published_plugins WHERE id = ?').bind(plugin.id).run();
        return json({ ok: true }, cors);
      }

      const pubVersionsMatch = path.match(/^\/admin\/published\/([a-z0-9_-]+)\/versions$/);
      if (pubVersionsMatch && method === 'POST') {
        const slug = pubVersionsMatch[1];
        const plugin = await env.DB.prepare(
          'SELECT * FROM published_plugins WHERE slug = ?'
        ).bind(slug).first();
        if (!plugin) return error('Not found', 404, cors);

        const formData = await request.formData();
        const file = formData.get('file');
        const version = formData.get('version');
        const changelog_md = formData.get('changelog_md') || '';
        const mc_version = formData.get('mc_version') || '';

        if (!file) return error('No file provided', 400, cors);
        if (!version) return error('Version required', 400, cors);

        const r2_key = `published-jars/${slug}/${slug}-${version}.jar`;
        await env.FILES.put(r2_key, file.stream());

        const result = await env.DB.prepare(`
          INSERT INTO published_versions (plugin_id, version, changelog_md, mc_version, r2_key, filename, size_bytes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(plugin.id, version, changelog_md, mc_version, r2_key, file.name, file.size).run();

        const versionId = result.meta.last_row_id;
        await env.DB.prepare(
          'UPDATE published_plugins SET current_version_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).bind(versionId, plugin.id).run();

        return json({ ok: true, version_id: versionId }, cors);
      }

      const pubVerOneMatch = path.match(/^\/admin\/published\/([a-z0-9_-]+)\/versions\/(\d+)$/);
      if (pubVerOneMatch && method === 'DELETE') {
        const slug = pubVerOneMatch[1];
        const vid = pubVerOneMatch[2];

        const plugin = await env.DB.prepare(
          'SELECT * FROM published_plugins WHERE slug = ?'
        ).bind(slug).first();
        if (!plugin) return error('Not found', 404, cors);

        const ver = await env.DB.prepare(
          'SELECT * FROM published_versions WHERE id = ? AND plugin_id = ?'
        ).bind(vid, plugin.id).first();
        if (!ver) return error('Version not found', 404, cors);

        await env.FILES.delete(ver.r2_key);
        await env.DB.prepare('DELETE FROM published_versions WHERE id = ?').bind(vid).run();

        if (plugin.current_version_id == vid) {
          const next = await env.DB.prepare(
            'SELECT id FROM published_versions WHERE plugin_id = ? ORDER BY created_at DESC LIMIT 1'
          ).bind(plugin.id).first();
          await env.DB.prepare(
            'UPDATE published_plugins SET current_version_id = ?, updated_at = datetime(\'now\') WHERE id = ?'
          ).bind(next ? next.id : null, plugin.id).run();
        }

        return json({ ok: true }, cors);
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
