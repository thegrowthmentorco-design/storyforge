export async function extract({ file, text, filename } = {}) {
  const form = new FormData()
  if (file) form.append('file', file, file.name)
  if (text) form.append('text', text)
  if (filename) form.append('filename', filename)

  const res = await fetch('/api/extract', { method: 'POST', body: form })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      // body wasn't JSON; fall back to status text
    }
    throw new Error(detail)
  }
  return res.json()
}

export async function health() {
  const res = await fetch('/api/health')
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
  return res.json()
}
