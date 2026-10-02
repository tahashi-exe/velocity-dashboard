const githubApi = 'https://api.github.com'

// Base64 by way of btoa/atob rather than Buffer, so this file runs unchanged
// under Node and under Deno (the Supabase Edge Function).
export function toBase64(bytes) {
  let binary = ''
  const chunk = 0x8000 // String.fromCharCode's argument limit is well above this
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function encodeJson(value) {
  return toBase64(new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`))
}

function decodeJson(content) {
  // GitHub wraps the base64 across lines.
  const binary = atob(content.replace(/\s/g, ''))
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))))
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    // GitHub rejects API calls with no User-Agent, and Deno doesn't always
    // send one of its own accord the way Node does.
    'User-Agent': 'velocity-telegram-bot',
  }
}

export async function getJsonFile({ token, repository, branch, path, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${githubApi}/repos/${repository}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: headers(token) },
  )

  if (!response.ok) {
    throw new Error(`GitHub could not read ${path}: ${response.status} ${await response.text()}`)
  }

  const file = await response.json()
  return { sha: file.sha, data: decodeJson(file.content) }
}

// Photos land at a random, never-reused path (see bot.js), so this always
// creates a new file rather than updating one — no sha needed.
export async function uploadBinaryFile({ token, repository, branch, path, base64, message, fetchImpl = fetch }) {
  const response = await fetchImpl(`${githubApi}/repos/${repository}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: base64, branch }),
  })

  if (!response.ok) {
    throw new Error(`GitHub could not upload ${path}: ${response.status} ${await response.text()}`)
  }

  return response.json()
}

export async function updateJsonFile({ token, repository, branch, path, sha, data, message, fetchImpl = fetch }) {
  const response = await fetchImpl(`${githubApi}/repos/${repository}/contents/${path}`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: encodeJson(data),
      sha,
      branch,
    }),
  })

  if (!response.ok) {
    throw new Error(`GitHub could not update ${path}: ${response.status} ${await response.text()}`)
  }

  return response.json()
}
