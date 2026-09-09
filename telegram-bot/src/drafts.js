/* Draft persistence: whatever half-finished answers exist get written to a
   local JSON file after every step, so a process restart resumes instead of
   losing the whole entry.

   Plain `fs`, no dependency. NOTE: this survives a *restart*, not a
   *redeploy* — Railway gives each deploy a fresh filesystem (see README). */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export function draftsFile() {
  return process.env.DRAFTS_FILE || path.join(os.tmpdir(), 'velocity-bot-drafts.json')
}

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(draftsFile(), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // missing file, unreadable file, or corrupt JSON — start clean rather than crash
    return {}
  }
}

function writeAll(all) {
  const file = draftsFile()
  const tmp = `${file}.tmp`
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(tmp, `${JSON.stringify(all, null, 2)}\n`)
    fs.renameSync(tmp, file)
  } catch (error) {
    // A draft we can't persist is not worth killing the bot over.
    console.error('Could not write drafts file:', error.message)
  }
}

function isUsable(session) {
  return Boolean(
    session
    && typeof session === 'object'
    && ['clubs', 'events'].includes(session.collection)
    && ['add', 'update'].includes(session.action)
    && ['form', 'photos', 'preview'].includes(session.mode)
    && session.answers && typeof session.answers === 'object'
    && (typeof session.savedAt !== 'number' || Date.now() - session.savedAt < MAX_AGE_MS),
  )
}

// chatId -> session, for everything still valid on disk.
export function loadDrafts() {
  const sessions = new Map()
  for (const [chatId, session] of Object.entries(readAll())) {
    if (isUsable(session)) sessions.set(String(chatId), session)
  }
  return sessions
}

export function saveDraft(chatId, session) {
  const all = readAll()
  all[String(chatId)] = { ...session, savedAt: Date.now() }
  writeAll(all)
}

export function deleteDraft(chatId) {
  const all = readAll()
  if (!(String(chatId) in all)) return
  delete all[String(chatId)]
  writeAll(all)
}
