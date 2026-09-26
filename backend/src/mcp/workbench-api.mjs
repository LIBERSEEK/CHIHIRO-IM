export function createWorkbenchApi(base = process.env.CHIHIRO_URL || 'http://127.0.0.1:3100') {
  return async function api(method, path, body) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
    return json
  }
}
