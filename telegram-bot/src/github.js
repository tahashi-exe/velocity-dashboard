const githubApi = 'https://api.github.com'

function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString('base64')
}

function decodeJson(content) {
  return JSON.parse(Buffer.from(content, 'base64').toString('utf8'))
}

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export async function getJsonFile({ token, repository, branch, path }) {
  const response = await fetch(
    `${githubApi}/repos/${repository}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    { headers: headers(token) },
  )

  if (!response.ok) {
    throw new Error(`GitHub could not read ${path}: ${response.status} ${await response.text()}`)
  }

  const file = await response.json()
  return { sha: file.sha, data: decodeJson(file.content) }
}

export async function updateJsonFile({ token, repository, branch, path, sha, data, message }) {
  const response = await fetch(`${githubApi}/repos/${repository}/contents/${path}`, {
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
